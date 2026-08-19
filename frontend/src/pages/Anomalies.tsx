import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { AlertTriangle, ChevronRight, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { fetchAnomalies, ThermalApiError } from "../lib/api";
import type { LiveAnomalyOverview, LiveAnomalySeverity, LiveAnomalyStatus } from "../types";
import { Card, CardHeader, StatusBadge } from "../components/ui";

const MAX_CHART_POINTS = 12;

interface AnomalyChartDatum {
  id: number;
  roomLabel: string;
  residual: number;
  threshold: number;
  excess: number;
  openedAt: string;
  closedAt: string | null;
  status: LiveAnomalyStatus;
  severity: LiveAnomalySeverity;
  cause: string | null;
  causeConfidence: string | null;
  supervisorDecision: string | null;
}

function formatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type RiskLevel = "safe" | "warn" | "danger";

const RISK_TONES: Record<RiskLevel, string> = {
  safe: "text-teal-600 dark:text-teal-300",
  warn: "text-amber-600 dark:text-amber-400",
  danger: "text-red-600 dark:text-red-400",
};

function StatCard({ label, value, risk, filter, active, onHover, onClick }: { label: string; value: string; risk: RiskLevel; filter?: boolean; active?: boolean; onHover?: (hover: boolean) => void; onClick?: () => void }) {
  const tone = RISK_TONES[risk];
  return (
    <div
      role={filter || onHover ? "button" : undefined}
      tabIndex={filter || onHover ? 0 : undefined}
      onMouseEnter={onHover ? () => onHover(true) : undefined}
      onMouseLeave={onHover ? () => onHover(false) : undefined}
      onFocus={onHover ? () => onHover(true) : undefined}
      onBlur={onHover ? () => onHover(false) : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e: ReactKeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={clsx(
        "flex flex-col items-center justify-center gap-1 rounded-2xl border bg-white p-5 text-center shadow-sm transition dark:bg-ink-900",
        active ? "border-primary-500 ring-2 ring-primary-500 ring-offset-2 dark:ring-offset-ink-900" : "border-ink-100 dark:border-ink-800",
        (onClick || onHover) && "cursor-pointer hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md"
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className={`text-3xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

function AnomalyTooltip({ active, payload }: { active?: boolean; payload?: { payload: AnomalyChartDatum | null }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload.find((p) => p.payload != null)?.payload;
  if (!d) return null;
  const date =
    d.closedAt
      ? `${new Date(d.openedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · ${new Date(d.openedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}–${new Date(d.closedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
      : new Date(d.openedAt).toLocaleString();
  return (
    <div className="min-w-[230px] rounded-xl border border-ink-200 bg-white p-4 text-[13px] shadow-lg dark:border-ink-700 dark:bg-ink-900">
      <p className="font-medium text-ink-800 dark:text-ink-100">{d.roomLabel} · Anomaly #{d.id}</p>
      <p className="mt-0.5 text-[12px] text-ink-400">{date}</p>
      <dl className="mt-3 space-y-1.5">
        <div className="flex justify-between gap-6"><dt className="text-ink-400">Residual</dt><dd className="font-medium">{d.residual.toFixed(2)}°C</dd></div>
        <div className="flex justify-between gap-6"><dt className="text-ink-400">Threshold</dt><dd className="font-medium">{d.threshold.toFixed(2)}°C</dd></div>
        <div className="flex justify-between gap-6">
          <dt className="text-ink-400">Excess</dt>
          <dd className={clsx("font-semibold", d.excess > 0 ? "text-red-600 dark:text-red-300" : "text-teal-600 dark:text-teal-300")}>
            {d.excess > 0 ? "+" : ""}{d.excess.toFixed(2)}°C
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <StatusBadge status={d.severity} />
        <StatusBadge status={d.status} />
        {d.cause && <span className="text-[12px] text-ink-400">Cause: <span className="font-medium text-ink-700 dark:text-ink-200">{formatKey(d.cause)}</span></span>}
      </div>
      {d.supervisorDecision && (
        <p className="mt-2 text-[12px] text-ink-400">Safety gate: <span className="font-medium text-ink-700 dark:text-ink-200">{d.supervisorDecision.replace("_", " ")}</span></p>
      )}
    </div>
  );
}

function isDark() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

const SEVERITIES: { id: LiveAnomalySeverity | "all"; label: string }[] = [
  { id: "all", label: "All severities" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];
const STATUSES: { id: LiveAnomalyStatus | "all"; label: string }[] = [
  { id: "all", label: "All statuses" },
  { id: "open", label: "Open" },
  { id: "diagnosed", label: "Diagnosed" },
  { id: "resolved", label: "Resolved" },
];
const severityDot: Record<LiveAnomalySeverity, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-teal-500",
};

export default function Anomalies() {
  const { buildingId = "esi-algiers" } = useParams();
  const navigate = useNavigate();
  const [anomalies, setAnomalies] = useState<LiveAnomalyOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sev, setSev] = useState<LiveAnomalySeverity | "all">("all");
  const [status, setStatus] = useState<LiveAnomalyStatus | "all">("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "largest">("newest");
  const [hoverFilter, setHoverFilter] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const matchesHover = (a: LiveAnomalyOverview): boolean => {
    switch (hoverFilter) {
      case "open":
        return a.status === "open";
      case "diagnosed":
        return a.status === "diagnosed";
      case "resolved":
        return a.status === "resolved";
      case "high":
        return a.severity === "high";
      case "excess":
        return (a.residualC ?? 0) - (a.thresholdC ?? 0) > 0;
      default:
        return false;
    }
  };

  const resetCardFilters = () => {
    setSev("all");
    setStatus("all");
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchAnomalies(buildingId, controller.signal)
      .then(setAnomalies)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ThermalApiError ? err.message : "Failed to load anomalies");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [buildingId, reloadKey]);

  const filtered = useMemo(() => {
    const list = (anomalies ?? []).filter((a) => (sev === "all" || a.severity === sev) && (status === "all" || a.status === status));
    return [...list].sort((a, b) => {
      if (sort === "newest") return +new Date(b.openedAt) - +new Date(a.openedAt);
      if (sort === "oldest") return +new Date(a.openedAt) - +new Date(b.openedAt);
      return Math.abs(b.residualC ?? 0) - Math.abs(a.residualC ?? 0);
    });
  }, [anomalies, sev, status, sort]);

  const chartData = useMemo<AnomalyChartDatum[]>(
    () =>
      (anomalies ?? [])
        .map((a) => {
          const residual = a.residualC !== null ? Math.abs(a.residualC) : 0;
          const threshold = a.thresholdC ?? 0;
          return {
            id: a.anomalyId,
            roomLabel: a.roomLabel,
            residual,
            threshold,
            excess: residual - threshold,
            openedAt: a.openedAt,
            closedAt: a.closedAt,
            status: a.status,
            severity: a.severity,
            cause: a.cause,
            causeConfidence: a.causeConfidence,
            supervisorDecision: a.supervisorDecision,
          };
        })
        .sort((x, y) => y.excess - x.excess),
    [anomalies]
  );
  const chartPoints = chartData.slice(0, MAX_CHART_POINTS);

  const stats = useMemo(() => {
    const list = anomalies ?? [];
    const open = list.filter((a) => a.status === "open").length;
    const high = list.filter((a) => a.severity === "high").length;
    const avgExcess = list.length
      ? list.reduce((s, a) => s + ((a.residualC ?? 0) - (a.thresholdC ?? 0)), 0) / list.length
      : 0;
    return { total: list.length, open, high, avgExcess };
  }, [anomalies]);

  const selectCls = "rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-[13px] text-ink-700 outline-none dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-medium">Anomalies</h1>
        </div>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-ink-200 px-3.5 py-2 text-[13px] font-medium text-ink-700 transition hover:bg-ink-50 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && (
        <Card className="mt-6 border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
          <p className="flex items-center gap-2 text-[13px] font-medium text-red-700 dark:text-red-300">
            <AlertTriangle size={15} /> {error}
          </p>
        </Card>
      )}

      {!error && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Detected Anomalies" value={loading ? "—" : String(stats.total)}
              risk={stats.total === 0 ? "safe" : stats.total <= 2 ? "warn" : "danger"}
              filter active={sev === "all" && status === "all"}
              onClick={() => resetCardFilters()}
            />
            <StatCard
              label="Awaiting Diagnosis" value={loading ? "—" : String(stats.open)}
              risk={stats.open === 0 ? "safe" : stats.open <= 2 ? "warn" : "danger"}
              filter active={status === "open"}
              onHover={(h) => setHoverFilter(h ? "open" : null)}
              onClick={() => { setStatus("open"); setSev("all"); }}
            />
            <StatCard
              label="High-Severity Anomalies" value={loading ? "—" : String(stats.high)}
              risk={stats.high === 0 ? "safe" : "danger"}
              filter active={sev === "high"}
              onHover={(h) => setHoverFilter(h ? "high" : null)}
              onClick={() => { setSev("high"); setStatus("all"); }}
            />
            <StatCard
              label="Avg. Threshold Exceedance" value={loading ? "—" : `${stats.avgExcess > 0 ? "+" : ""}${stats.avgExcess.toFixed(2)}°C`}
              risk={stats.avgExcess <= 0 ? "safe" : stats.avgExcess <= 1 ? "warn" : "danger"}
              filter active={sev === "all" && status === "all"}
              onHover={(h) => setHoverFilter(h ? "excess" : null)}
              onClick={() => resetCardFilters()}
            />
          </div>

          <Card className="mt-6">
            <CardHeader
              title="Anomaly severity"
              subtitle="Temperature deviation compared with the detection threshold. A point above the dashed line means the anomaly exceeded its threshold. Click a point to open its diagnosis."
            />
            <div className="relative h-56 px-2 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartPoints} margin={{ left: 6, right: 16, top: 8, bottom: 0 }}>
                  <XAxis dataKey="id" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#8c897d" }} tickFormatter={(v: number) => `#${v}`} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8c897d" }} width={34} unit="°C" domain={[0, "auto"]} />
                  <Tooltip
                    cursor={{ stroke: isDark() ? "#3a392f" : "#e8e7e3", strokeDasharray: "3 3" }}
                    content={<AnomalyTooltip />}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="threshold" name="Threshold" stroke="#8c897d" strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                  <Line
                    type="monotone"
                    dataKey="residual"
                    name="Residual (|measured − predicted|)"
                    stroke="#ee6c1f"
                    strokeWidth={2}
                    dot={({ cx, cy, payload }: { cx?: number; cy?: number; payload?: AnomalyChartDatum }) => {
                      if (cx === undefined || cy === undefined) return <g />;
                      const isOver = payload ? payload.excess > 0 : false;
                      return (
                        <circle
                          key={payload?.id}
                          cx={cx}
                          cy={cy}
                          r={5}
                          fill={isOver ? "#ee6c1f" : "#1d9e75"}
                          stroke="#fff"
                          strokeWidth={1.5}
                          style={{ cursor: "pointer" }}
                          onClick={() => navigate(`/b/${buildingId}/anomalies/${payload?.id}`)}
                        />
                      );
                    }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-5 py-3 text-[12px] text-ink-400 dark:border-ink-800">
              <span>Sorted by residual − threshold, most severe first.{chartData.length > MAX_CHART_POINTS ? ` Showing ${MAX_CHART_POINTS} of ${chartData.length} anomalies.` : ""}</span>
              <Link to={`/b/${buildingId}/anomalies`} className="font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400">View all →</Link>
            </div>
          </Card>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <select className={selectCls} value={sev} onChange={(e) => setSev(e.target.value as LiveAnomalySeverity | "all")}>
              {SEVERITIES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value as LiveAnomalyStatus | "all")}>
              {STATUSES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <select className={selectCls} value={sort} onChange={(e) => setSort(e.target.value as "newest" | "oldest" | "largest")}>
              <option value="newest">Sort: Newest</option>
              <option value="oldest">Sort: Oldest</option>
              <option value="largest">Sort: Largest residual</option>
            </select>
            <p className="ml-auto text-[12px] text-ink-400">{loading ? "loading…" : `${filtered.length} anomaly(ies)`}</p>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            {loading &&
              Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="animate-pulse p-4">
                  <div className="h-4 w-48 rounded bg-ink-100 dark:bg-ink-800" />
                </Card>
              ))}

            {!loading && filtered.length === 0 && (
              <Card className="p-8 text-center text-[13px] text-ink-400">No anomalies match these filters.</Card>
            )}

            {!loading &&
              filtered.map((a) => (
                <Link key={a.anomalyId} to={`/b/${buildingId}/anomalies/${a.anomalyId}`}>
                  <Card
                    key={`${a.anomalyId}-card`}
                    className={clsx(
                      "flex items-center justify-between p-4 transition hover:border-primary-300",
                      hoverFilter && matchesHover(a) && "border-primary-300 bg-primary-50/60 dark:bg-primary-900/20"
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <span className={clsx("h-2.5 w-2.5 shrink-0 rounded-full", severityDot[a.severity])} />
                      <div>
                        <p className="text-[14px] font-medium">{a.roomLabel}</p>
                        <p className="text-[12px] text-ink-400">{new Date(a.openedAt).toLocaleString()}</p>
                        <p className="mt-0.5 text-[12px] text-ink-400">
                          residual{" "}
                          <span className={clsx("font-semibold", (a.residualC ?? 0) > 0 ? "text-red-600 dark:text-red-300" : "text-teal-600 dark:text-teal-300")}>
                            {a.residualC !== null ? `${a.residualC > 0 ? "+" : ""}${a.residualC.toFixed(2)}°C` : "—"}
                          </span>{" "}
                          vs threshold <span className="font-medium text-ink-700 dark:text-ink-200">{a.thresholdC?.toFixed(2) ?? "—"}°C</span>
                          {a.cause && <> · likely cause <span className="font-medium text-ink-700 dark:text-ink-200">{a.cause}</span></>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={a.severity} />
                      <StatusBadge status={a.status} />
                      <ChevronRight size={16} className="text-ink-300" />
                    </div>
                  </Card>
                </Link>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
