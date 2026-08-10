import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { AlertTriangle, ChevronRight, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { fetchAnomalies, ThermalApiError } from "../lib/api";
import type { LiveAnomalyOverview, LiveAnomalySeverity, LiveAnomalyStatus } from "../types";
import { Card, CardHeader, StatusBadge } from "../components/ui";

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
  const [anomalies, setAnomalies] = useState<LiveAnomalyOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sev, setSev] = useState<LiveAnomalySeverity | "all">("all");
  const [status, setStatus] = useState<LiveAnomalyStatus | "all">("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "largest">("newest");
  const [reloadKey, setReloadKey] = useState(0);

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

  const chartData = useMemo(
    () =>
      filtered.slice(0, 8).map((a) => ({
        name: a.roomLabel,
        residual: a.residualC !== null ? Math.abs(a.residualC) : 0,
        threshold: a.thresholdC ?? 0,
      })),
    [filtered]
  );

  const selectCls = "rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-[13px] text-ink-700 outline-none dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-medium">Anomalies</h1>
          <p className="mt-1 text-[13px] text-ink-400">Raised by Agent 2 when a room's measured temperature diverges from its calibrated thermal prediction — live, not mocked.</p>
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
          <Card className="mt-6">
            <CardHeader title="Residual vs. threshold" subtitle="How far each anomaly's measured temperature deviates from Agent 2's prediction, and the threshold that triggered it (up to 8 filtered anomalies)" />
            <div className="h-56 px-2 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ left: 6, right: 12, top: 8, bottom: 0 }}>
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#8c897d" }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8c897d" }} width={34} unit="°C" />
                  <Tooltip
                    cursor={{ fill: isDark() ? "#2a2925" : "#f5f4f1" }}
                    contentStyle={{
                      borderRadius: 12,
                      border: isDark() ? "1px solid #3a392f" : "1px solid #e8e7e3",
                      fontSize: 12,
                      background: isDark() ? "#2a2925" : "#fff",
                      color: isDark() ? "#f5f4f1" : "#23231f",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="residual" name="|Residual| °C" fill="#ee6c1f" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="threshold" name="Threshold °C" fill="#8c897d" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
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
                  <Card className="flex items-center justify-between p-4 transition hover:border-primary-300">
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
