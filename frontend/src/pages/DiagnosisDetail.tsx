import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Wrench } from "lucide-react";
import { fetchAnomalyDetail, ThermalApiError } from "../lib/api";
import type { LiveAnomalyDetail } from "../types";
import { Card, CardHeader, SecondaryButton, StatusBadge } from "../components/ui";

function formatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

export default function DiagnosisDetail() {
  const { buildingId = "esi-algiers", anomalyId = "" } = useParams();
  const navigate = useNavigate();
  const [anomaly, setAnomaly] = useState<LiveAnomalyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchAnomalyDetail(buildingId, Number(anomalyId), controller.signal)
      .then(setAnomaly)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ThermalApiError ? err.message : "Failed to load anomaly");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [buildingId, anomalyId]);

  if (loading) return <p className="text-[14px] text-ink-400">Loading…</p>;

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
        <p className="flex items-center gap-2 text-[13px] font-medium text-red-700 dark:text-red-300">
          <AlertTriangle size={15} /> {error}
        </p>
      </Card>
    );
  }

  if (!anomaly) return <p className="text-[14px] text-ink-400">Anomaly not found.</p>;

  const { diagnosis } = anomaly;
  const recurrence = diagnosis?.recurrence ?? {};
  const seenBefore = Boolean(recurrence.seen_before);
  const actionEntries = diagnosis ? Object.entries(diagnosis.proposedAction).filter(([k]) => k !== "type") : [];

  return (
    <div className="mx-auto max-w-4xl">
      <SecondaryButton onClick={() => navigate(`/b/${buildingId}/anomalies`)} className="mb-3">
        <ArrowLeft size={14} /> Back to anomalies
      </SecondaryButton>

      <p className="text-[12px] text-ink-400">
        <Link to={`/b/${buildingId}/anomalies`} className="hover:text-primary-600">Anomalies</Link> / {anomaly.roomLabel}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-[20px] font-medium">{anomaly.roomLabel} — thermal anomaly</h1>
        <StatusBadge status={anomaly.severity} />
        <StatusBadge status={anomaly.status} />
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <Card className="p-4">
          <p className="text-[12px] text-ink-400">Residual</p>
          <p className="text-xl font-medium">{anomaly.residualC !== null ? `${anomaly.residualC > 0 ? "+" : ""}${anomaly.residualC.toFixed(2)}°C` : "—"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[12px] text-ink-400">Threshold</p>
          <p className="text-xl font-medium">{anomaly.thresholdC?.toFixed(2) ?? "—"}°C</p>
        </Card>
        <Card className="p-4">
          <p className="text-[12px] text-ink-400">Opened</p>
          <p className="text-xl font-medium">{new Date(anomaly.openedAt).toLocaleString()}</p>
        </Card>
      </div>

      {anomaly.residualTrace.length > 0 && (
        <Card className="mt-5 p-5">
          <p className="mb-2 text-[13px] font-medium text-ink-800 dark:text-ink-100">Residual trace (the consecutive samples that raised this anomaly)</p>
          <div className="flex flex-wrap gap-2">
            {anomaly.residualTrace.map((s, i) => (
              <span key={i} className="rounded-lg bg-ink-50 px-2.5 py-1 text-[12px] text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                {new Date(s.ts).toLocaleTimeString()} · {s.residual_c > 0 ? "+" : ""}{s.residual_c.toFixed(2)}°C
              </span>
            ))}
          </div>
        </Card>
      )}

      {diagnosis ? (
        <>
          <Card className="mt-5">
            <CardHeader title="Diagnostic agent's diagnosis" subtitle={`Confidence: ${diagnosis.causeConfidence} · from ${new Date(diagnosis.createdAt).toLocaleString()}`} />
            <div className="px-5 pb-5">
              <p className="text-[14px] leading-relaxed">{diagnosis.message}</p>
              <p className="mt-2 text-[13px] text-ink-400">
                Cause: <span className="font-medium text-ink-700 dark:text-ink-200">{diagnosis.cause}</span> · estimated{" "}
                <span className="font-medium text-ink-700 dark:text-ink-200">{diagnosis.energyWastedKwh} kWh</span> wasted ({diagnosis.energyWastedBasis})
              </p>
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-primary-50 p-4 dark:bg-primary-900/40">
                <Wrench size={16} className="mt-0.5 shrink-0 text-primary-600 dark:text-primary-400" />
                <div>
                  <p className="text-[13px] font-medium text-primary-800 dark:text-primary-300">
                    Proposed action: {formatKey(String(diagnosis.proposedAction.type ?? "unknown"))}
                  </p>
                  {actionEntries.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-[13px] text-primary-700 dark:text-primary-400">
                      {actionEntries.map(([k, v]) => (
                        <li key={k}>{formatKey(k)}: {formatValue(v)}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              {seenBefore && (
                <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-4 dark:bg-amber-950/40">
                  <Clock size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div>
                    <p className="text-[13px] font-medium text-amber-800 dark:text-amber-300">Seen before</p>
                    {typeof recurrence.last_occurrence === "string" && (
                      <p className="text-[13px] text-amber-700 dark:text-amber-400">Last occurrence: {recurrence.last_occurrence}</p>
                    )}
                    {typeof recurrence.long_term_recommendation === "string" && recurrence.long_term_recommendation && (
                      <p className="text-[13px] text-amber-700 dark:text-amber-400">{recurrence.long_term_recommendation}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card className="mt-5">
            <CardHeader title="Evidence gathered" subtitle="Tools the diagnostic agent actually called before answering" />
            <div className="divide-y divide-ink-100 dark:divide-ink-800">
              {diagnosis.evidence.map((e, i) => (
                <div key={i} className="flex items-start gap-3 px-5 py-3.5">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-teal-600" />
                  <p className="font-mono text-[13px]">{e}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="mt-5 p-5">
            <p className="text-[13px] text-ink-400">Supervisor decision (deterministic — not made by the LLM)</p>
            <div className="mt-2">
              <StatusBadge status={diagnosis.supervisorDecision === "human_alert" ? "medium" : "low"} label={diagnosis.supervisorDecision.replace("_", " ")} />
            </div>
          </Card>
        </>
      ) : (
        <Card className="mt-5 p-6 text-center text-[14px] text-ink-400">Not diagnosed yet — Agent 4 will call the diagnostic agent on its next cycle.</Card>
      )}
    </div>
  );
}
