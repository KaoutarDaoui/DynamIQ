import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { AlertTriangle, RefreshCw, Search, Download, X } from "lucide-react";
import clsx from "clsx";
import { fetchAnomalies, ThermalApiError } from "../lib/api";
import { CAUSES, actionLabel, causeLabel, decisionLabel } from "../lib/labels";
import type { LiveAnomalyOverview, LiveAnomalySeverity, LiveAnomalyStatus } from "../types";
import { Card, CardHeader } from "../components/ui";

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
  proposedAction: string | null;
}

function formatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function durationText(a: LiveAnomalyOverview): string {
  const start = +new Date(a.openedAt);
  const end = a.closedAt ? +new Date(a.closedAt) : Date.now();
  const mins = Math.max(0, Math.round((end - start) / 60000));
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const decisionBadgeOf: Record<string, { status: string; label: string }> = {
  autonomous: { status: "low", label: "Autonomous" },
  human_alert: { status: "high", label: "Needs human" },
  log_only: { status: "offline", label: "Log only" },
};

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

function ClickableTooltip({ d }: { d: AnomalyChartDatum }) {
  const navigate = useNavigate();
  const { buildingId = "esi-algiers" } = useParams();
  const date =
    d.closedAt
      ? `${new Date(d.openedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · ${new Date(d.openedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}–${new Date(d.closedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
      : new Date(d.openedAt).toLocaleString();
  return (
    <div
      className="absolute right-8 top-4 z-30 min-w-[260px] cursor-pointer rounded-xl border border-ink-200 bg-ink-50 p-4 text-[13px] shadow-lg transition hover:border-primary-300 dark:border-ink-700 dark:bg-ink-900"
      onClick={() => navigate(`/b/${buildingId}/anomalies/${d.id}`)}
    >
      <p className="font-medium text-ink-800 dark:text-ink-100">{d.roomLabel} · Anomaly #{d.id}</p>
      <p className="mt-0.5 text-[12px] text-ink-400">{date}</p>
      <dl className="mt-3 space-y-1.5">
        <div className="flex justify-between gap-6"><dt className="text-ink-400">Temperature deviation</dt><dd className="font-medium">{d.residual.toFixed(2)}°C</dd></div>
        <div className="flex justify-between gap-6"><dt className="text-ink-400">Detection threshold</dt><dd className="font-medium">{d.threshold.toFixed(2)}°C</dd></div>
        <div className="flex justify-between gap-6">
          <dt className="text-ink-400">Threshold exceeded by</dt>
          <dd className={clsx("font-semibold", d.excess > 0 ? "text-red-600 dark:text-red-300" : "text-teal-600 dark:text-teal-300")}>
            {d.excess > 0 ? "+" : ""}{d.excess.toFixed(2)}°C
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex items-center gap-3">
        <span
          className={clsx(
            "text-[12px] font-semibold capitalize",
            d.severity === "high"
              ? "text-red-600 dark:text-red-400"
              : d.severity === "medium"
                ? "text-amber-600 dark:text-amber-400"
                : "text-teal-600 dark:text-teal-300"
          )}
        >
          {d.severity}
        </span>
        <span
          className={clsx(
            "text-[12px] font-semibold capitalize",
            d.status === "open"
              ? "text-red-600 dark:text-red-400"
              : d.status === "diagnosed"
                ? "text-primary-600 dark:text-primary-400"
                : "text-teal-600 dark:text-teal-300"
          )}
        >
          {d.status}
        </span>
      </div>
      {d.cause && (
        <div className="mt-3 text-[12px]">
          <p className="text-ink-400">Cause</p>
          <p className="font-medium text-ink-800 dark:text-ink-100">{d.cause.replace(/_/g, " ")}</p>
        </div>
      )}
      {d.proposedAction && (
        <div className="mt-2 text-[12px]">
          <p className="text-ink-400">Recommended action</p>
          <p className="font-medium text-ink-800 dark:text-ink-100">{actionLabel(d.proposedAction)}</p>
        </div>
      )}
      <div className="mt-2 text-[12px]">
        <p className="text-ink-400">Supervisor decision</p>
        <p className="font-medium text-ink-800 dark:text-ink-100">{decisionLabel(d.supervisorDecision)}</p>
        {d.supervisorDecision === "human_alert" && <p className="text-[12px] text-ink-400 capitalize">Safety decision: {d.supervisorDecision.replace("_", " ")}</p>}
      </div>
      <div className="mt-3 border-t border-ink-100 pt-2.5 dark:border-ink-800">
        <span className="font-medium text-primary-600 dark:text-primary-400">View full diagnosis →</span>
      </div>
    </div>
  );
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
const severityTone: Record<LiveAnomalySeverity, string> = {
  high: "text-ink-600 dark:text-ink-300",
  medium: "text-ink-600 dark:text-ink-300",
  low: "text-ink-600 dark:text-ink-300",
};

const statusPill: Record<LiveAnomalyStatus, string> = {
  open: "bg-red-500/10 text-red-700 dark:text-red-300",
  diagnosed: "bg-primary-500/10 text-primary-700 dark:text-primary-300",
  resolved: "bg-teal-500/10 text-teal-700 dark:text-teal-300",
};

const decisionTone: Record<string, string> = {
  autonomous: "text-ink-600 dark:text-ink-300",
  human_alert: "text-ink-600 dark:text-ink-300",
  log_only: "text-ink-600 dark:text-ink-300",
};

function ToneText({ tone, label, title }: { tone: string; label: string; title?: string }) {
  return (
    <span title={title} className={clsx("text-[13px] capitalize", tone)}>
      {label}
    </span>
  );
}

export default function Anomalies() {
  const { buildingId = "esi-algiers" } = useParams();
  const navigate = useNavigate();
  const [anomalies, setAnomalies] = useState<LiveAnomalyOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sev, setSev] = useState<LiveAnomalySeverity | "all">("all");
  const [status, setStatus] = useState<LiveAnomalyStatus | "all">("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "largest">("newest");
  const [cause, setCause] = useState<string>("all");
  const [decision, setDecision] = useState<string>("all");
  const [room, setRoom] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [page, setPage] = useState(1);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [hoverFilter, setHoverFilter] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [datePreset, setDatePreset] = useState<"24h" | "3d" | "7d" | "30d" | "custom">("3d");

  const clearFilters = () => {
    setSev("all");
    setStatus("all");
    setCause("all");
    setDecision("all");
    setRoom("all");
    setSearch("");
    setFrom("");
    setTo("");
    setDatePreset("3d");
  };

  const clearSearch = () => setSearch("");

  const exportCSV = () => {
    const headers = [
      "Room", "Anomaly", "Detected", "Duration", "Deviation (°C)", "Threshold (°C)",
      "Cause", "Decision", "Severity", "Status"
    ];
    const rows = pageItems.map((a) => [
      a.roomLabel,
      formatKey(a.anomalyType),
      new Date(a.openedAt).toLocaleString(),
      durationText(a),
      a.residualC?.toFixed(2) ?? "—",
      a.thresholdC?.toFixed(2) ?? "—",
      a.cause ?? "—",
      a.supervisorDecision ?? "—",
      a.severity,
      a.status
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `anomalies-${buildingId}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const matchesHover = (a: LiveAnomalyOverview): boolean => {
    switch (hoverFilter) {
      case "open":
        return a.status === "open" && a.anomalyType === "thermal_anomaly";
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
    setError(null);
    fetchAnomalies(buildingId, controller.signal)
      .then((data) => {
        setAnomalies(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ThermalApiError ? err.message : "Failed to load anomalies");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [buildingId, reloadKey]);

  useEffect(() => {
    const id = setInterval(() => setReloadKey((k) => k + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // The date window is the one filter that also governs the stat cards and
  // the intensity chart above the table (see `windowed` below) — everything
  // else (severity, status, cause, ...) only narrows the table itself.
  const dateRange = useMemo(() => {
    const now = Date.now();
    if (datePreset === "custom") {
      return {
        fromTs: from ? +new Date(`${from}T00:00:00`) : null,
        toTs: to ? +new Date(`${to}T23:59:59`) : null,
      };
    }
    const days = datePreset === "24h" ? 1 : datePreset === "3d" ? 3 : datePreset === "7d" ? 7 : 30;
    return { fromTs: now - days * 24 * 60 * 60 * 1000, toTs: now };
  }, [datePreset, from, to]);

  const windowed = useMemo(() => {
    const { fromTs, toTs } = dateRange;
    return (anomalies ?? []).filter((a) => {
      const ts = +new Date(a.openedAt);
      return (fromTs === null || ts >= fromTs) && (toTs === null || ts <= toTs);
    });
  }, [anomalies, dateRange]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = windowed.filter((a) => {
      const haystack = `${a.roomLabel} ${a.anomalyType} ${a.cause ?? ""} ${a.supervisorDecision ?? ""} ${a.status} ${a.severity}`.toLowerCase();
      return (
        (q === "" || haystack.includes(q)) &&
        (sev === "all" || a.severity === sev) &&
        (status === "all" || a.status === status) &&
        (cause === "all" || a.cause === cause) &&
        (decision === "all" || a.supervisorDecision === decision) &&
        (room === "all" || a.roomId === room)
      );
    });
    return [...list].sort((a, b) => {
      if (sort === "newest") return +new Date(b.openedAt) - +new Date(a.openedAt);
      if (sort === "oldest") return +new Date(a.openedAt) - +new Date(b.openedAt);
      return Math.abs(b.residualC ?? 0) - Math.abs(a.residualC ?? 0);
    });
  }, [windowed, sev, status, cause, decision, room, search, sort]);

  const PAGE_SIZE = 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const decisionOptions = useMemo(() => {
    const set = new Set<string>();
    (anomalies ?? []).forEach((a) => {
      if (a.supervisorDecision) set.add(a.supervisorDecision);
    });
    return [...set].sort();
  }, [anomalies]);

  const roomOptions = useMemo(() => {
    const labels = new Map<string, string>();
    ((anomalies ?? []).slice().reverse()).forEach((a) => {
      if (a.roomId && !labels.has(a.roomId)) labels.set(a.roomId, a.roomLabel);
    });
    return [...labels.entries()].sort((x, y) => x[1].localeCompare(y[1]));
  }, [anomalies]);

  const chartData = useMemo<AnomalyChartDatum[]>(
    () =>
      windowed
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
            proposedAction: a.proposedAction ?? null,
          };
        })
        .sort((x, y) => y.excess - x.excess),
    [windowed]
  );
  const chartPoints = chartData.slice(0, MAX_CHART_POINTS);

  const stats = useMemo(() => {
    const list = windowed;
    // sensor_fault / comfort_violation are never diagnosed by design (Agent
    // 3 only reasons about thermal_anomaly's physical causes) -- counting
    // them here would show a permanent, never-shrinking "awaiting
    // diagnosis" number for anomalies that were never queued for one.
    const open = list.filter((a) => a.status === "open" && a.anomalyType === "thermal_anomaly").length;
    const high = list.filter((a) => a.severity === "high").length;
    const avgExcess = list.length
      ? list.reduce((s, a) => s + ((a.residualC ?? 0) - (a.thresholdC ?? 0)), 0) / list.length
      : 0;
    return { total: list.length, open, high, avgExcess };
  }, [windowed]);

  const selectCls = "rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-[13px] text-ink-700 outline-none dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200";
  const dateInputCls = "rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-[13px] text-ink-700 outline-none dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200 dark:[color-scheme:dark]";
  const windowLabel =
    datePreset === "24h" ? "last 24 hours" :
    datePreset === "3d" ? "last 3 days" :
    datePreset === "7d" ? "last 7 days" :
    datePreset === "30d" ? "last 30 days" :
    "the selected date range";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-medium">Anomalies</h1>
          <p className="mt-1 text-[13px] text-ink-400">
            Showing {windowLabel} · change the Date filter below to widen or narrow this
          </p>
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
          <p className="mt-6 text-[11px] font-medium uppercase tracking-wide text-ink-400">
            {windowLabel[0].toUpperCase() + windowLabel.slice(1)}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Detected Anomalies" value={loading ? "—" : String(stats.total)}
              risk={stats.total === 0 ? "safe" : stats.total <= 2 ? "warn" : "danger"}
              filter
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
              filter
              onHover={(h) => setHoverFilter(h ? "excess" : null)}
              onClick={() => resetCardFilters()}
            />
          </div>

          <Card className="mt-6">
<CardHeader
                title="Anomaly Intensity"
                subtitle="Deviation vs. detection threshold per room"
              />
            <div
                className="relative mt-3 h-56 px-14 pb-4"
                onMouseLeave={() => setHoverId(null)}
              >
              {hoverId !== null && (() => {
                const d = chartPoints.find((p) => p.id === hoverId);
                return d ? <ClickableTooltip d={d} /> : null;
              })()}
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartPoints}
                  margin={{ left: 12, right: 16, top: 8, bottom: 0 }}
                  onMouseLeave={() => setHoverId(null)}
                >
                  <Tooltip
                    cursor={false}
                    content={(props: { active?: boolean; payload?: ReadonlyArray<{ payload?: AnomalyChartDatum | null }> }) => {
                      const p = props.active && props.payload ? props.payload.find((x) => x.payload != null) : null;
                      const d = p?.payload ?? null;
                      if (d) setHoverId(d.id);
                      return null;
                    }}
                  />
                  <XAxis dataKey="roomLabel" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#8c897d" }} interval={0} tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 12)}…` : v)} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8c897d" }} width={52} unit="°C" domain={[0, "auto"]} />
                  <Line type="monotone" dataKey="threshold" name="Limit" stroke="#8c897d" strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                  <Line
                    type="monotone"
                    dataKey="residual"
                    name="Deviation"
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
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-ink-100 px-6 py-3 text-[12px] text-ink-400 dark:border-ink-800">
              <span className="flex items-center gap-2"><span className="inline-block h-0.5 w-5 rounded bg-primary-500" />Deviation</span>
              <span className="flex items-center gap-2"><span className="inline-block w-5 border-t-2 border-dashed border-ink-400" />Limit</span>
              <span>Sorted by residual − threshold, most severe first.{chartData.length > MAX_CHART_POINTS ? ` Showing ${MAX_CHART_POINTS} of ${chartData.length} anomalies.` : ""}</span>
            </div>
          </Card>

          <Card className="mt-6">
            <CardHeader
              title="All anomalies"
              subtitle="Track every anomaly from detection to diagnosis, supervisor decision, and resolution."
            />
            <div className="border-b border-ink-100 px-5 pt-2 dark:border-ink-800">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                type="search"
                placeholder="Search room, anomaly, cause…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-ink-200 bg-ink-50 py-2 pl-9 pr-3 text-[13px] text-ink-700 outline-none placeholder:text-ink-400 focus:placeholder:text-ink-200 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200 dark:placeholder:text-ink-400 dark:focus:placeholder:text-ink-200"
              />
              {search && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 pb-6 pt-4">
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
            <select className={selectCls} value={cause} onChange={(e) => setCause(e.target.value)}>
              <option value="all">All causes</option>
              {CAUSES.map((c) => (
                <option key={c} value={c}>{causeLabel(c)}</option>
              ))}
            </select>
            <select className={selectCls} value={decision} onChange={(e) => setDecision(e.target.value)}>
              <option value="all">All decisions</option>
              {decisionOptions.map((d) => (
                <option key={d} value={d}>{formatKey(d)}</option>
              ))}
            </select>
            <select className={selectCls} value={room} onChange={(e) => setRoom(e.target.value)}>
              <option value="all">All rooms</option>
              {roomOptions.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-ink-400">Date</span>
              <select
                className={selectCls}
                value={datePreset}
                onChange={(e) => setDatePreset(e.target.value as "24h" | "3d" | "7d" | "30d" | "custom")}
              >
                <option value="24h">Last 24h</option>
                <option value="3d">Last 3 days</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            {datePreset === "custom" && (
              <>
                <input type="date" className={dateInputCls} title="From date" value={from} onChange={(e) => setFrom(e.target.value)} />
                <input type="date" className={dateInputCls} title="To date" value={to} onChange={(e) => setTo(e.target.value)} />
              </>
            )}
            <select className={selectCls} value={sort} onChange={(e) => setSort(e.target.value as "newest" | "oldest" | "largest")}>
              <option value="newest">Sort: Newest</option>
              <option value="oldest">Sort: Oldest</option>
              <option value="largest">Sort: Largest residual</option>
            </select>
            <button
              type="button"
              onClick={exportCSV}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-[13px] font-medium text-ink-700 transition hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200 dark:hover:bg-ink-800"
            >
              <Download size={14} /> Export CSV
            </button>
            </div>
            </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr className="border-b border-ink-200 text-[12px] uppercase tracking-wide text-ink-400 dark:border-ink-700">
                  <th className="px-5 py-3 font-medium">Room</th>
                  <th className="px-3 py-3 font-medium">Anomaly</th>
                  <th className="px-3 py-3 font-medium">Detected</th>
                  <th className="px-3 py-3 font-medium">Duration</th>
                  <th className="px-3 py-3 font-medium">Deviation / Limit</th>
                  <th className="px-3 py-3 font-medium">Cause</th>
                  <th className="px-3 py-3 font-medium">Decision</th>
                  <th className="px-3 py-3 font-medium">Severity</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {loading &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-5 py-4"><div className="h-4 w-32 rounded bg-ink-100 dark:bg-ink-800" /></td>
                      <td className="px-3 py-4"><div className="h-4 w-24 rounded bg-ink-100 dark:bg-ink-800" /></td>
                      <td className="px-3 py-4"><div className="h-4 w-32 rounded bg-ink-100 dark:bg-ink-800" /></td>
                      <td className="px-3 py-4"><div className="h-4 w-20 rounded bg-ink-100 dark:bg-ink-800" /></td>
                      <td className="px-3 py-4"><div className="h-4 w-24 rounded bg-ink-100 dark:bg-ink-800" /></td>
                      <td className="px-3 py-4"><div className="h-4 w-36 rounded bg-ink-100 dark:bg-ink-800" /></td>
                      <td className="px-3 py-4"><div className="h-4 w-20 rounded bg-ink-100 dark:bg-ink-800" /></td>
                      <td className="px-3 py-4"><div className="h-4 w-16 rounded bg-ink-100 dark:bg-ink-800" /></td>
                      <td className="px-3 py-4"><div className="h-4 w-16 rounded bg-ink-100 dark:bg-ink-800" /></td>
                    </tr>
                  ))}

                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-5 py-12 text-center">
                      <div className="space-y-4">
                        <p className="text-[14px] font-medium text-ink-700 dark:text-ink-200">No anomalies match your current filters.</p>
                        <p className="text-[13px] text-ink-400">Try adjusting or clearing your filters.</p>
                        <div className="flex items-center justify-center gap-2">
                          {(sev !== "all" || status !== "all" || cause !== "all" || decision !== "all" || room !== "all" || search) && (
                            <button type="button" onClick={clearFilters} className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-[12px] font-medium text-ink-700 transition hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200 dark:hover:bg-ink-800">
                              <X size={14} /> Clear all filters
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}

                {!loading &&
                  pageItems.map((a) => {
                    const db = a.supervisorDecision ? decisionBadgeOf[a.supervisorDecision] : null;
                    return (
                      <tr
                        key={a.anomalyId}
                        className={clsx(
                          "group transition hover:bg-ink-50 dark:hover:bg-ink-800/50",
                          hoverFilter && matchesHover(a) && "bg-primary-50/60 dark:bg-primary-900/20"
                        )}
                      >
                        <td className="px-5 py-3">
                          <p className="text-[13px] font-medium text-ink-800 group-hover:text-primary-600 dark:text-ink-100 dark:group-hover:text-primary-400">{a.roomLabel}</p>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <p className="text-[13px] text-ink-700 dark:text-ink-200">{formatKey(a.anomalyType)}</p>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <p className="whitespace-nowrap text-[13px] text-ink-700 dark:text-ink-200">
                            {new Date(a.openedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                          </p>
                          <p className="whitespace-nowrap text-[12px] text-ink-400">
                            {new Date(a.openedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <p className="whitespace-nowrap text-[13px] text-ink-700 dark:text-ink-200">{durationText(a)}</p>
                          <p className="text-[12px] text-ink-400">{a.status === "open" ? "still open" : "closed"}</p>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <p className={clsx("whitespace-nowrap text-[13px] font-semibold", (a.residualC ?? 0) > 0 ? "text-red-600 dark:text-red-300" : "text-teal-600 dark:text-teal-300")}>
                            {a.residualC !== null ? `${a.residualC > 0 ? "+" : ""}${a.residualC.toFixed(2)}°C` : "—"}
                          </p>
                          <p className="whitespace-nowrap text-[12px] text-ink-400">limit {a.thresholdC?.toFixed(2) ?? "—"}°C</p>
                        </td>
                        <td className="px-3 py-3 align-top">
                          {a.cause ? (
                            <>
                              <p className="text-[13px] text-ink-700 dark:text-ink-200">{a.cause.replace(/_/g, " ")}</p>
                              {a.causeConfidence && <p className="text-[12px] text-ink-400">confidence: {a.causeConfidence}</p>}
                            </>
                          ) : (
                            <p className="text-[12px] text-ink-400">—</p>
                          )}
                        </td>
                        <td className="px-3 py-3 align-top">
                          {db ? (
                            <ToneText
                              tone={decisionTone[a.supervisorDecision ?? ""] ?? "text-ink-400"}
                              label={db.label}
                              title={a.supervisorDecision === "log_only" ? "Same room + cause diagnosed within the 30-day cooldown — re-alert suppressed." : undefined}
                            />
                          ) : (
                            <span className="text-[12px] text-ink-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 align-top"><ToneText tone={severityTone[a.severity]} label={a.severity} /></td>
                        <td className="px-3 py-3 align-top">
                          <span className={clsx("rounded-full px-2.5 py-1 text-[12px] font-medium capitalize", statusPill[a.status])}>{a.status}</span>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/b/${buildingId}/anomalies/${a.anomalyId}`);
                            }}
                            className="rounded-lg border border-ink-200 px-3 py-1.5 text-[12px] font-medium text-ink-500 transition hover:bg-ink-100 hover:border-ink-300 dark:border-ink-700 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:border-ink-600"
                          >
                            Details
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-ink-100 px-6 py-3 text-[12px] text-ink-400 dark:border-ink-800">
            <span>
              {loading
                ? "Loading…"
                : filtered.length === 0
                  ? "0 anomalies"
                  : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filtered.length)} of ${filtered.length}`}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => p - 1)}
                disabled={currentPage <= 1}
                className="rounded-lg border border-ink-200 px-2.5 py-1.5 text-[12px] font-medium text-ink-700 transition hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"
              >
                ‹ Prev
              </button>
              <span className="tabular-nums">Page {currentPage} of {pageCount}</span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={currentPage >= pageCount}
                className="rounded-lg border border-ink-200 px-2.5 py-1.5 text-[12px] font-medium text-ink-700 transition hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"
              >
                Next ›
              </button>
            </div>
          </div>
          </Card>
        </>
      )}
    </div>
  );
}
