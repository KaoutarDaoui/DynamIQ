import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ChevronRight, RefreshCw, Zap } from "lucide-react";
import { Bar, BarChart, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchDiagnoses, ThermalApiError } from "../lib/api";
import { CAUSES, causeLabel } from "../lib/labels";
import type { LiveDiagnosisOverview } from "../types";
import { Card, CardHeader, StatusBadge } from "../components/ui";

type Confidence = "high" | "medium" | "low" | "undetermined";
type Decision = "autonomous" | "human_alert" | "log_only";

const CONFIDENCES: { id: Confidence | "all"; label: string }[] = [
  { id: "all", label: "All confidence levels" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
  { id: "undetermined", label: "Undetermined" },
];
const DECISIONS: { id: Decision | "all"; label: string }[] = [
  { id: "all", label: "All decisions" },
  { id: "autonomous", label: "Autonomous" },
  { id: "human_alert", label: "Human alert" },
  { id: "log_only", label: "Log only" },
];
const decisionBadge: Record<string, { status: string; label: string }> = {
  autonomous: { status: "low", label: "Autonomous" },
  human_alert: { status: "medium", label: "Human alert" },
  log_only: { status: "offline", label: "Log only" },
};
const confidenceBadgeStatus: Record<string, string> = { high: "high", medium: "medium", low: "low", undetermined: "watch" };

function formatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isDark() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

const PIE_COLORS = ["#ee6c1f", "#1d9e75", "#e2b93b", "#8c897d", "#7c6fdf", "#3b82f6", "#64748b"];

export default function Diagnoses() {
  const { buildingId = "esi-algiers" } = useParams();
  const [diagnoses, setDiagnoses] = useState<LiveDiagnosisOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confidence, setConfidence] = useState<Confidence | "all">("all");
  const [cause, setCause] = useState<string>("all");
  const [decision, setDecision] = useState<Decision | "all">("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "energy">("newest");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchDiagnoses(buildingId, controller.signal)
      .then(setDiagnoses)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ThermalApiError ? err.message : "Failed to load diagnoses");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [buildingId, reloadKey]);

  const filtered = useMemo(() => {
    const list = (diagnoses ?? []).filter(
      (d) =>
        (confidence === "all" || d.causeConfidence === confidence) &&
        (cause === "all" || d.cause === cause) &&
        (decision === "all" || d.supervisorDecision === decision)
    );
    return [...list].sort((a, b) => {
      if (sort === "newest") return +new Date(b.createdAt) - +new Date(a.createdAt);
      if (sort === "oldest") return +new Date(a.createdAt) - +new Date(b.createdAt);
      return b.energyWastedKwh - a.energyWastedKwh;
    });
  }, [diagnoses, confidence, cause, decision, sort]);

  const causeBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    (diagnoses ?? []).forEach((d) => counts.set(d.cause, (counts.get(d.cause) ?? 0) + 1));
    return [...counts.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [diagnoses]);

  const energyByCause = useMemo(() => {
    const totals = new Map<string, number>();
    (diagnoses ?? []).forEach((d) => totals.set(d.cause, (totals.get(d.cause) ?? 0) + d.energyWastedKwh));
    return [...totals.entries()].map(([name, kwh]) => ({ name, kwh })).sort((a, b) => b.kwh - a.kwh);
  }, [diagnoses]);

  const undeterminedCount = useMemo(() => (diagnoses ?? []).filter((d) => d.causeConfidence === "undetermined").length, [diagnoses]);

  const topCause = useMemo(() => {
    let best: string | null = null;
    let bestCount = 0;
    causeBreakdown.forEach((c) => {
      if (c.value > bestCount) {
        bestCount = c.value;
        best = c.name;
      }
    });
    return best;
  }, [causeBreakdown]);

  const totalEnergyWasted = useMemo(() => (diagnoses ?? []).reduce((sum, d) => sum + d.energyWastedKwh, 0), [diagnoses]);
  const autonomousCount = useMemo(() => (diagnoses ?? []).filter((d) => d.supervisorDecision === "autonomous").length, [diagnoses]);
  const humanAlertCount = useMemo(() => (diagnoses ?? []).filter((d) => d.supervisorDecision === "human_alert").length, [diagnoses]);

  const selectCls = "rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-[13px] text-ink-700 outline-none dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-medium">Diagnoses</h1>
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
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <Card className="p-4">
              <p className="text-[12px] text-ink-400">Total diagnoses</p>
              <p className="mt-1 text-xl font-medium">{loading ? "—" : diagnoses?.length ?? 0}</p>
            </Card>
            <Card className="p-4">
              <p className="flex items-center gap-1.5 text-[12px] text-ink-400"><Zap size={13} className="text-amber-500" /> Energy wasted (est.)</p>
              <p className="mt-1 text-xl font-medium">{loading ? "—" : `${totalEnergyWasted.toFixed(1)} kWh`}</p>
            </Card>
            <Card className="p-4">
              <p className="text-[12px] text-ink-400">Handled autonomously</p>
              <p className="mt-1 text-xl font-medium">{loading ? "—" : autonomousCount}</p>
            </Card>
            <Card className="p-4">
              <p className="text-[12px] text-ink-400">Routed to a human</p>
              <p className="mt-1 text-xl font-medium">{loading ? "—" : humanAlertCount}</p>
            </Card>
            <Card className="p-4">
              <p className="text-[12px] text-ink-400">Undetermined origin</p>
              <p className="mt-1 text-xl font-medium">{loading ? "—" : undeterminedCount}</p>
            </Card>
            <Card className="p-4">
              <p className="text-[12px] text-ink-400">Top cause</p>
              <p className="mt-1 truncate text-xl font-medium">{loading || !topCause ? "—" : formatKey(topCause)}</p>
            </Card>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Diagnoses by cause" subtitle="How often each root cause was concluded by the diagnostic agent" />
              <div className="h-64 px-2 pb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={causeBreakdown} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2} isAnimationActive={false}>
                      {causeBreakdown.map((entry, i) => (
                        <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <CardHeader title="Energy wasted by cause" subtitle="Cumulative estimated kWh attributed to each cause" />
              <div className="h-64 px-2 pb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={energyByCause} margin={{ left: 6, right: 12, top: 8, bottom: 0 }}>
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#8c897d" }} interval={0} angle={-20} textAnchor="end" height={50} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8c897d" }} width={50} unit=" kWh" />
                    <Tooltip cursor={{ fill: isDark() ? "#2a2925" : "#f5f4f1" }} contentStyle={{ borderRadius: 12, border: isDark() ? "1px solid #3a392f" : "1px solid #e8e7e3", fontSize: 12, background: isDark() ? "#2a2925" : "#fff", color: isDark() ? "#f5f4f1" : "#23231f" }} />
                    <Bar dataKey="kwh" name="Energy wasted (kWh)" fill="#ee6c1f" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card className="mt-5">
            <CardHeader title="All diagnoses" subtitle="Root cause, confidence, proposed action and the deterministic supervisor decision" />
            <div className="flex flex-wrap items-center gap-3 px-5 pb-4">
              <select className={selectCls} value={confidence} onChange={(e) => setConfidence(e.target.value as Confidence | "all")}>
                {CONFIDENCES.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <select className={selectCls} value={cause} onChange={(e) => setCause(e.target.value)}>
                <option value="all">All causes</option>
                {CAUSES.map((c) => (
                  <option key={c} value={c}>{causeLabel(c)}</option>
                ))}
              </select>
              <select className={selectCls} value={decision} onChange={(e) => setDecision(e.target.value as Decision | "all")}>
                {DECISIONS.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
              <select className={selectCls} value={sort} onChange={(e) => setSort(e.target.value as "newest" | "oldest" | "energy")}>
                <option value="newest">Sort: Newest</option>
                <option value="oldest">Sort: Oldest</option>
                <option value="energy">Sort: Most energy wasted</option>
              </select>
              <p className="ml-auto text-[12px] text-ink-400">{loading ? "loading…" : `${filtered.length} diagnosis(es)`}</p>
            </div>

            <div className="flex flex-col divide-y divide-ink-100 dark:divide-ink-800">
              {loading &&
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="animate-pulse px-5 py-4">
                    <div className="h-4 w-56 rounded bg-ink-100 dark:bg-ink-800" />
                  </div>
                ))}

              {!loading && filtered.length === 0 && (
                <p className="px-5 py-8 text-center text-[13px] text-ink-400">No diagnoses match these filters.</p>
              )}

              {!loading &&
                filtered.map((d) => {
                  const badge = decisionBadge[d.supervisorDecision] ?? { status: "offline", label: d.supervisorDecision };
                  return (
                    <Link key={d.id} to={`/b/${buildingId}/anomalies/${d.anomalyId}`} state={{ from: "diagnoses" }} className="flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-ink-50 dark:hover:bg-ink-800/50">
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium">{d.roomLabel} <span className="font-normal text-ink-400">· Floor {d.floorLevel}</span></p>
                        <p className="mt-0.5 truncate text-[13px] text-ink-600 dark:text-ink-300">{d.message}</p>
                        <p className="mt-1 text-[12px] text-ink-400">
                          {new Date(d.createdAt).toLocaleString()} · cause <span className="font-medium text-ink-700 dark:text-ink-200">{formatKey(d.cause)}</span> · proposed{" "}
                          <span className="font-medium text-ink-700 dark:text-ink-200">{formatKey(d.proposedActionType)}</span> ·{" "}
                          <span className="font-medium text-ink-700 dark:text-ink-200">{d.energyWastedKwh} kWh</span> wasted
                          {d.energyWastedBasis !== "mpc_counterfactual" && <> · basis {d.energyWastedBasis.replace(/_/g, " ")}</>}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={confidenceBadgeStatus[d.causeConfidence] ?? "offline"} label={d.causeConfidence} />
                        <span title={d.supervisorDecision === "log_only" ? "Same room + cause diagnosed within the 30-day cooldown — re-alert suppressed." : undefined}>
                          <StatusBadge status={badge.status} label={badge.label} />
                        </span>
                        <ChevronRight size={16} className="text-ink-300" />
                      </div>
                    </Link>
                  );
                })}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
