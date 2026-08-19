import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, RefreshCw, Search, Download, X } from "lucide-react";
import clsx from "clsx";
import { Bar, BarChart, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchDiagnoses, ThermalApiError } from "../lib/api";
import { CAUSES, causeLabel } from "../lib/labels";
import type { LiveDiagnosisOverview } from "../types";
import { Card, CardHeader } from "../components/ui";

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

const confidenceTone: Record<string, string> = {
  high: "text-teal-600 dark:text-teal-300",
  medium: "text-amber-600 dark:text-amber-400",
  low: "text-ink-600 dark:text-ink-300",
  undetermined: "text-ink-400 dark:text-ink-500",
};

const decisionTone: Record<string, string> = {
  autonomous: "text-teal-600 dark:text-teal-300",
  human_alert: "text-red-600 dark:text-red-400",
  log_only: "text-ink-400 dark:text-ink-500",
};

type RiskLevel = "safe" | "warn" | "danger";

const RISK_TONES: Record<RiskLevel, string> = {
  safe: "text-teal-600 dark:text-teal-300",
  warn: "text-amber-600 dark:text-amber-400",
  danger: "text-red-600 dark:text-red-400",
};

function StatCard({ label, value, risk, filter, active, onClick }: { label: string; value: string; risk: RiskLevel; filter?: boolean; active?: boolean; onClick?: () => void }) {
  const tone = RISK_TONES[risk];
  return (
    <div
      role={filter ? "button" : undefined}
      tabIndex={filter ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e: ReactKeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={clsx(
        "flex flex-col items-center justify-center gap-1 rounded-2xl border bg-white p-5 text-center shadow-sm transition dark:bg-ink-900",
        active ? "border-primary-500 ring-2 ring-primary-500 ring-offset-2 dark:ring-offset-ink-900" : "border-ink-100 dark:border-ink-800",
        onClick && "cursor-pointer hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md"
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className={clsx("text-3xl font-semibold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

function formatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isDark() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

const PIE_COLORS = ["#ee6c1f", "#1d9e75", "#e2b93b", "#8c897d", "#7c6fdf", "#3b82f6", "#64748b"];

export default function Diagnoses() {
  const navigate = useNavigate();
  const { buildingId = "esi-algiers" } = useParams();
  const [diagnoses, setDiagnoses] = useState<LiveDiagnosisOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confidence, setConfidence] = useState<Confidence | "all">("all");
  const [cause, setCause] = useState<string>("all");
  const [decision, setDecision] = useState<Decision | "all">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "energy">("newest");
  const [page, setPage] = useState(1);
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
    const q = search.trim().toLowerCase();
    const list = (diagnoses ?? []).filter(
      (d) =>
        (confidence === "all" || d.causeConfidence === confidence) &&
        (cause === "all" || d.cause === cause) &&
        (decision === "all" || d.supervisorDecision === decision) &&
        (!q || `${d.roomLabel} ${d.cause} ${d.proposedActionType} ${d.message}`.toLowerCase().includes(q))
    );
    return [...list].sort((a, b) => {
      if (sort === "newest") return +new Date(b.createdAt) - +new Date(a.createdAt);
      if (sort === "oldest") return +new Date(a.createdAt) - +new Date(b.createdAt);
      return b.energyWastedKwh - a.energyWastedKwh;
    });
  }, [diagnoses, confidence, cause, decision, search, sort]);

  const PAGE_SIZE = 5;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

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

  const resetCardFilters = () => {
    setConfidence("all");
    setCause("all");
    setDecision("all");
    setSearch("");
    setSort("newest");
    setPage(1);
  };

  const exportCSV = () => {
    const rows = filtered.map((d) => ({
      room: d.roomLabel,
      floor: d.floorLevel,
      cause: d.cause,
      confidence: d.causeConfidence,
      proposed_action: d.proposedActionType,
      supervisor_decision: d.supervisorDecision,
      energy_wasted_kwh: d.energyWastedKwh,
      created_at: d.createdAt,
    }));
    const header = Object.keys(rows[0] ?? {}).join(",");
    const body = rows.map((r) => Object.values(r).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diagnoses.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

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
            <StatCard
              label="Total diagnoses"
              value={loading ? "—" : String(diagnoses?.length ?? 0)}
              risk={(diagnoses?.length ?? 0) > 10 ? "warn" : "safe"}
              filter
              active={confidence === "all" && cause === "all" && decision === "all" && !search}
              onClick={() => resetCardFilters()}
            />
            <StatCard
              label="Energy wasted (est.)"
              value={loading ? "—" : `${totalEnergyWasted.toFixed(1)} kWh`}
              risk={totalEnergyWasted <= 0 ? "safe" : totalEnergyWasted <= 50 ? "warn" : "danger"}
              filter
              active={sort === "energy"}
              onClick={() => { setSort("energy"); setPage(1); }}
            />
            <StatCard
              label="Handled autonomously"
              value={loading ? "—" : String(autonomousCount)}
              risk={autonomousCount === 0 ? "warn" : "safe"}
              filter active={decision === "autonomous"}
              onClick={() => { setDecision("autonomous"); setPage(1); }}
            />
            <StatCard
              label="Routed to a human"
              value={loading ? "—" : String(humanAlertCount)}
              risk={humanAlertCount === 0 ? "safe" : "danger"}
              filter active={decision === "human_alert"}
              onClick={() => { setDecision("human_alert"); setPage(1); }}
            />
            <StatCard
              label="Undetermined origin"
              value={loading ? "—" : String(undeterminedCount)}
              risk={undeterminedCount === 0 ? "safe" : "warn"}
              filter active={confidence === "undetermined"}
              onClick={() => { setConfidence("undetermined"); setPage(1); }}
            />
            <StatCard
              label="Top cause"
              value={loading || !topCause ? "—" : formatKey(topCause)}
              risk="safe"
              filter active={cause === topCause}
              onClick={() => { if (topCause) { setCause(cause === topCause ? "all" : topCause); setPage(1); } }}
            />
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
            <div className="border-b border-ink-100 px-5 pt-2 dark:border-ink-800">
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input
                  type="search"
                  placeholder="Search room, cause, action, message…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="w-full rounded-lg border border-ink-200 bg-ink-50 py-2 pl-9 pr-3 text-[13px] text-ink-700 outline-none placeholder:text-ink-400 focus:placeholder:text-ink-200 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200 dark:placeholder:text-ink-400 dark:focus:placeholder:text-ink-200"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 pb-6 pt-4">
                <select className={selectCls} value={confidence} onChange={(e) => { setConfidence(e.target.value as Confidence | "all"); setPage(1); }}>
                  {CONFIDENCES.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
                <select className={selectCls} value={cause} onChange={(e) => { setCause(e.target.value); setPage(1); }}>
                  <option value="all">All causes</option>
                  {CAUSES.map((c) => (
                    <option key={c} value={c}>{causeLabel(c)}</option>
                  ))}
                </select>
                <select className={selectCls} value={decision} onChange={(e) => { setDecision(e.target.value as Decision | "all"); setPage(1); }}>
                  {DECISIONS.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
                <select className={selectCls} value={sort} onChange={(e) => { setSort(e.target.value as "newest" | "oldest" | "energy"); setPage(1); }}>
                  <option value="newest">Sort: Newest</option>
                  <option value="oldest">Sort: Oldest</option>
                  <option value="energy">Sort: Most energy wasted</option>
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
              <table className="w-full min-w-[900px] table-fixed border-collapse text-left">
                <thead>
                  <tr className="border-b border-ink-200 text-[12px] uppercase tracking-wide text-ink-400 dark:border-ink-700">
                    <th className="w-[14%] px-5 py-3 font-medium">Room</th>
                    <th className="w-[30%] px-3 py-3 font-medium">Cause</th>
                    <th className="w-[14%] px-3 py-3 font-medium">Proposed action</th>
                    <th className="w-[11%] px-3 py-3 font-medium">Energy</th>
                    <th className="w-[10%] px-3 py-3 font-medium">Confidence</th>
                    <th className="w-[11%] px-3 py-3 font-medium">Decision</th>
                    <th className="w-[14%] px-3 py-3 font-medium">Diagnosed</th>
                    <th className="px-3 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                  {loading &&
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        <td className="px-5 py-4"><div className="h-4 w-32 rounded bg-ink-100 dark:bg-ink-800" /></td>
                        <td className="px-3 py-4"><div className="h-4 w-36 rounded bg-ink-100 dark:bg-ink-800" /></td>
                        <td className="px-3 py-4"><div className="h-4 w-32 rounded bg-ink-100 dark:bg-ink-800" /></td>
                        <td className="px-3 py-4"><div className="h-4 w-20 rounded bg-ink-100 dark:bg-ink-800" /></td>
                        <td className="px-3 py-4"><div className="h-4 w-16 rounded bg-ink-100 dark:bg-ink-800" /></td>
                        <td className="px-3 py-4"><div className="h-4 w-20 rounded bg-ink-100 dark:bg-ink-800" /></td>
                        <td className="px-3 py-4"><div className="h-4 w-32 rounded bg-ink-100 dark:bg-ink-800" /></td>
                        <td className="px-3 py-4"><div className="h-4 w-16 rounded bg-ink-100 dark:bg-ink-800" /></td>
                      </tr>
                    ))}

                  {!loading && filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center">
                        <div className="space-y-4">
                          <p className="text-[14px] font-medium text-ink-700 dark:text-ink-200">No diagnoses match your current filters.</p>
                          <p className="text-[13px] text-ink-400">Try adjusting or clearing your filters.</p>
                          <div className="flex items-center justify-center gap-2">
                            {(confidence !== "all" || cause !== "all" || decision !== "all" || search) && (
                              <button type="button" onClick={resetCardFilters} className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-[12px] font-medium text-ink-700 transition hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200 dark:hover:bg-ink-800">
                                <X size={14} /> Clear all filters
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    pageItems.map((d) => {
                      const badge = decisionBadge[d.supervisorDecision] ?? { status: "offline", label: d.supervisorDecision };
                      return (
                        <tr
                          key={d.id}
                          className="group transition hover:bg-ink-50 dark:hover:bg-ink-800/50"
                        >
                          <td className="px-5 py-3">
                            <p className="text-[13px] font-medium text-ink-800 group-hover:text-primary-600 dark:text-ink-100 dark:group-hover:text-primary-400">{d.roomLabel}</p>
                            <p className="text-[12px] text-ink-400">Floor {d.floorLevel}</p>
                          </td>
                          <td className="w-[30%] px-3 py-3 align-top">
                            <p className="text-[13px] text-ink-700 dark:text-ink-200">{formatKey(d.cause)}</p>
                            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-400">{d.message}</p>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <p className="text-[13px] text-ink-700 dark:text-ink-200">{formatKey(d.proposedActionType)}</p>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <p className="whitespace-nowrap text-[13px] text-ink-700 dark:text-ink-200">{d.energyWastedKwh.toFixed(1)} kWh</p>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <p className={clsx("text-[13px] font-medium capitalize", confidenceTone[d.causeConfidence] ?? "text-ink-500 dark:text-ink-400")}>{d.causeConfidence}</p>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <p
                              title={d.supervisorDecision === "log_only" ? "Same room + cause diagnosed within the 30-day cooldown — re-alert suppressed." : undefined}
                              className={clsx("text-[13px] font-medium capitalize", decisionTone[d.supervisorDecision] ?? "text-ink-500 dark:text-ink-400")}
                            >
                              {badge.label}
                            </p>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <p className="whitespace-nowrap text-[13px] text-ink-700 dark:text-ink-200">
                              {new Date(d.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                            </p>
                            <p className="whitespace-nowrap text-[12px] text-ink-400">
                              {new Date(d.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <button
                              onClick={() => navigate(`/b/${buildingId}/anomalies/${d.anomalyId}`, { state: { from: "diagnoses" } })}
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
                    ? "0 diagnoses"
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
