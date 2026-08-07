import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ChevronRight, RefreshCw, Zap } from "lucide-react";
import { fetchDiagnoses, ThermalApiError } from "../lib/api";
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
const confidenceBadgeStatus: Record<string, string> = { high: "high", medium: "medium", low: "low", undetermined: "offline" };

function formatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Diagnoses() {
  const { buildingId = "esi-algiers" } = useParams();
  const [diagnoses, setDiagnoses] = useState<LiveDiagnosisOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confidence, setConfidence] = useState<Confidence | "all">("all");
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
      (d) => (confidence === "all" || d.causeConfidence === confidence) && (decision === "all" || d.supervisorDecision === decision)
    );
    return [...list].sort((a, b) => {
      if (sort === "newest") return +new Date(b.createdAt) - +new Date(a.createdAt);
      if (sort === "oldest") return +new Date(a.createdAt) - +new Date(b.createdAt);
      return b.energyWastedKwh - a.energyWastedKwh;
    });
  }, [diagnoses, confidence, decision, sort]);

  const totalEnergyWasted = useMemo(() => (diagnoses ?? []).reduce((sum, d) => sum + d.energyWastedKwh, 0), [diagnoses]);
  const autonomousCount = useMemo(() => (diagnoses ?? []).filter((d) => d.supervisorDecision === "autonomous").length, [diagnoses]);
  const humanAlertCount = useMemo(() => (diagnoses ?? []).filter((d) => d.supervisorDecision === "human_alert").length, [diagnoses]);

  const selectCls = "rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-[13px] text-ink-700 outline-none dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-medium">Diagnoses</h1>
          <p className="mt-1 text-[13px] text-ink-400">Every root-cause conclusion Agent 3 has produced for this building — live from the diagnostic agent, not mocked.</p>
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
          </div>

          <Card className="mt-5">
            <CardHeader title="All diagnoses" subtitle="Root cause, confidence, proposed action and the deterministic supervisor decision" />
            <div className="flex flex-wrap items-center gap-3 px-5 pb-4">
              <select className={selectCls} value={confidence} onChange={(e) => setConfidence(e.target.value as Confidence | "all")}>
                {CONFIDENCES.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
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
                    <Link key={d.id} to={`/b/${buildingId}/anomalies/${d.anomalyId}`} className="flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-ink-50 dark:hover:bg-ink-800/50">
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium">{d.roomLabel} <span className="font-normal text-ink-400">· Floor {d.floorLevel}</span></p>
                        <p className="mt-0.5 truncate text-[13px] text-ink-600 dark:text-ink-300">{d.message}</p>
                        <p className="mt-1 text-[12px] text-ink-400">
                          {new Date(d.createdAt).toLocaleString()} · cause <span className="font-medium text-ink-700 dark:text-ink-200">{d.cause}</span> · proposed{" "}
                          <span className="font-medium text-ink-700 dark:text-ink-200">{formatKey(d.proposedActionType)}</span> ·{" "}
                          <span className="font-medium text-ink-700 dark:text-ink-200">{d.energyWastedKwh} kWh</span> wasted
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={confidenceBadgeStatus[d.causeConfidence] ?? "offline"} label={d.causeConfidence} />
                        <StatusBadge status={badge.status} label={badge.label} />
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
