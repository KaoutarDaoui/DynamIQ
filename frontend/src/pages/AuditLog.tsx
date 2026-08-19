import { useEffect, useState } from "react";
import { useSearchParams, useParams, Link } from "react-router-dom";
import { ChevronLeft, Search, AlertTriangle } from "lucide-react";
import { fetchAuditLog, ThermalApiError } from "../lib/api";
import type { AuditLog, AuditLogToolCall } from "../types";
import { Card, CardHeader } from "../components/ui";

function formatToolName(tool: string): string {
  return tool.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function generateToolDescription(tool: string, toolCall: AuditLogToolCall): string {
  const result = toolCall.result;
  if (Object.keys(result).length === 0 && toolCall.resultSummary) {
    return toolCall.resultSummary;
  }
  switch (tool) {
    case "get_sensor_history": {
      const series = result.series as Array<{ temp_measured_c: number }> | undefined;
      if (series && series.length > 0) {
        const temps = series.map(s => s.temp_measured_c).filter(t => t !== null && t !== undefined);
        if (temps.length > 0) {
          const min = Math.min(...temps);
          const max = Math.max(...temps);
          return `Temperature ranged from ${min.toFixed(1)}°C → ${max.toFixed(1)}°C over ${result.samples_returned} samples (${result.samples_total} total)`;
        }
      }
      return `Retrieved ${result.samples_returned} sensor readings over ${result.hours}h`;
    }
    case "get_calendar": {
      const blocks = result.occupancy_blocks_observed as Array<{ start: string; end: string }> | undefined;
      if (blocks && blocks.length > 0) {
        return `Found ${blocks.length} occupancy block(s) during the anomaly window`;
      }
      return "No occupancy blocks detected in the observation period";
    }
    case "get_hvac_logs": {
      const windowSec = result.window_seconds as number;
      const coolingSec = result.cooling_seconds as number;
      if (windowSec > 0) {
        const pct = Math.round((coolingSec / windowSec) * 100);
        return `Cooling was active for approximately ${pct}% of the observation window (${Math.round(coolingSec / 60)} min of ${Math.round(windowSec / 60)} min)`;
      }
      return `Retrieved ${result.changes_returned} HVAC state changes`;
    }
    case "get_mpc_trajectory": {
      const slots = result.trajectory as Array<{ setpoint_c: number; predicted_temp_c: number }> | undefined;
      if (slots && slots.length > 0) {
        const avgSetpoint = slots.reduce((sum, s) => sum + s.setpoint_c, 0) / slots.length;
        return `MPC planned ${slots.length} slots with average setpoint ${avgSetpoint.toFixed(1)}°C`;
      }
      return "No MPC trajectory available";
    }
    case "get_building_context": {
      const model = result.active_model as { rmse_validation?: number; anomaly_threshold_c?: number } | undefined;
      if (model?.rmse_validation) {
        return `Room geometry retrieved — active model RMSE: ${model.rmse_validation.toFixed(2)}°C, threshold: ${model.anomaly_threshold_c?.toFixed(2) ?? "N/A"}°C`;
      }
      return "Room geometry and thermal properties retrieved";
    }
    case "get_similar_anomalies": {
      const priors = result.prior_anomalies as Array<{ resolved_cause?: string }> | undefined;
      if (priors && priors.length > 0) {
        const causes = [...new Set(priors.map(p => p.resolved_cause).filter(Boolean))];
        return `Found ${priors.length} prior anomaly(ies) — resolved causes: ${causes.join(", ") || "none diagnosed"}`;
      }
      return "No similar prior anomalies found";
    }
    case "check_neighboring_zones": {
      const neighbors = result.neighbors as Array<{ latest_temp_c?: number }> | undefined;
      if (neighbors && neighbors.length > 0) {
        const withTemp = neighbors.filter(n => n.latest_temp_c !== null && n.latest_temp_c !== undefined);
        return `Checked ${neighbors.length} adjacent zone(s) — ${withTemp.length} with recent temperature data`;
      }
      return "No adjacent zone data available";
    }
    case "llm_reason":
      return "Evidence analyzed — cause classified from taxonomy";
    case "validate_output":
      return "Diagnosis validated against safety constraints";
    case "supervisor_decision":
      return "Autonomous action approved within safety limits";
    default:
      return "Tool executed";
  }
}

export default function AuditLogPage() {
  const { buildingId = "esi-algiers" } = useParams();
  const [searchParams] = useSearchParams();
  const anomalyId = searchParams.get("anomalyId");
  const [auditLog, setAuditLog] = useState<AuditLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!anomalyId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchAuditLog(Number(anomalyId), controller.signal)
      .then(setAuditLog)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ThermalApiError ? err.message : "Failed to load audit log");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [anomalyId]);

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

  if (!anomalyId) {
    return (
      <div className="mx-auto max-w-4xl">
        <Card className="mt-6 p-6 text-center text-[14px] text-ink-400">
          <p>Select an anomaly from the <Link to={`/b/${buildingId}/anomalies`} className="text-primary-600 hover:underline">Anomalies</Link> page to view its audit log.</p>
        </Card>
      </div>
    );
  }

  if (!auditLog) {
    return (
      <div className="mx-auto max-w-4xl">
        <Card className="mt-6 p-6 text-center text-[14px] text-ink-400">
          No audit log found for anomaly #{anomalyId}
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <nav className="mb-4 flex items-center gap-2 text-[13px] text-ink-400" aria-label="Breadcrumb">
        <Link to={`/b/${buildingId}`} className="hover:text-primary-600">Buildings</Link>
        <ChevronLeft size={14} />
        <Link to={`/b/${buildingId}/anomalies`} className="hover:text-primary-600">Anomalies</Link>
        <ChevronLeft size={14} />
        <Link to={`/b/${buildingId}/anomalies/${anomalyId}`} className="hover:text-primary-600">Anomaly #{anomalyId}</Link>
        <ChevronLeft size={14} />
        <span className="text-ink-600 dark:text-ink-300">Audit Log</span>
      </nav>

      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[20px] font-medium">Audit Log — Anomaly #{anomalyId}</h1>
          <p className="mt-1 text-[13px] text-ink-400">Agent activity and tool calls for this diagnosis</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-ink-400">Invoked: {new Date(auditLog.invokedAt).toLocaleString()}</span>
        </div>
      </div>

      {auditLog.modelOutput && (
        <Card className="mb-6">
          <CardHeader title="Model Output (Raw)" subtitle="Complete LLM output before deterministic post-processing" />
          <div className="px-5 pb-5">
            <pre className="bg-ink-900 text-ink-100 p-4 rounded-lg overflow-x-auto text-[11px] font-mono max-h-96">
              {JSON.stringify(auditLog.modelOutput, null, 2)}
            </pre>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Tool Calls" subtitle="Diagnostic agent investigation steps" />
        <div className="p-5">
          {auditLog.toolCalls.length === 0 ? (
            <p className="text-[13px] text-ink-400">No tool calls recorded for this diagnosis</p>
          ) : (
            <div className="space-y-4">
              {auditLog.toolCalls.map((tc, i) => {
                const description = generateToolDescription(tc.tool, tc);
                return (
                  <div key={i} className="relative flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                        <Search size={16} />
                      </div>
                      {!auditLog.toolCalls[i + 1] && <div className="mt-2 w-0.5 h-full bg-ink-200 dark:bg-ink-700" />}
                    </div>
                    <div className="flex-1 pt-1">
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-ink-800 dark:text-ink-100">{formatToolName(tc.tool)}</p>
                        <span className="text-[11px] text-ink-400 font-mono">{new Date(tc.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="mt-1 text-[13px] text-ink-600 dark:text-ink-300">{description}</p>
                      {Object.keys(tc.args).length > 0 && (
                        <details className="mt-2">
                          <summary className="text-[11px] text-primary-600 hover:underline cursor-pointer">Arguments</summary>
                          <pre className="mt-2 bg-ink-100 dark:bg-ink-800 p-3 rounded-lg text-[10px] font-mono overflow-x-auto max-h-48">
                            {JSON.stringify(tc.args, null, 2)}
                          </pre>
                        </details>
                      )}
                      {Object.keys(tc.result).length > 0 && (
                        <details className="mt-2">
                          <summary className="text-[11px] text-primary-600 hover:underline cursor-pointer">Result</summary>
                          <pre className="mt-2 bg-ink-100 dark:bg-ink-800 p-3 rounded-lg text-[10px] font-mono overflow-x-auto max-h-48">
                            {JSON.stringify(tc.result, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {auditLog.supervisorDecision && (
        <Card className="mt-6">
          <CardHeader title="Supervisor Decision" subtitle="Deterministic safety gate output" />
          <div className="px-5 pb-5">
            <pre className="bg-ink-100 dark:bg-ink-800 p-4 rounded-lg overflow-x-auto text-[11px] font-mono">
              {JSON.stringify(auditLog.supervisorDecision, null, 2)}
            </pre>
          </div>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader title="Action Decision" subtitle="Human decision on the recommended action" />
        <div className="px-5 pb-5">
          {auditLog.actionDecision ? (
            <div className={`rounded-xl border p-4 ${
              auditLog.actionDecision.decision === "applied"
                ? "border-green-200 bg-green-50 dark:border-green-900/30 dark:bg-green-900/20"
                : "border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-900/20"
            }`}>
              <div className="flex items-center gap-2">
                <span className={`text-[14px] font-medium ${
                  auditLog.actionDecision.decision === "applied" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"
                }`}>
                  {auditLog.actionDecision.decision === "applied" ? "Action Applied" : "Action Rejected"}
                </span>
              </div>
              <dl className="mt-3 space-y-2 text-[13px]">
                <div className="flex justify-between gap-6"><dt className="text-ink-400">Action type</dt><dd className="font-medium capitalize">{formatKey(auditLog.actionDecision.actionType ?? "—")}</dd></div>
                {auditLog.actionDecision.deltaC !== null && (
                  <div className="flex justify-between gap-6"><dt className="text-ink-400">Setpoint correction</dt><dd className="font-medium">{(auditLog.actionDecision.deltaC as number) > 0 ? "+" : ""}{(auditLog.actionDecision.deltaC as number).toFixed(1)}°C</dd></div>
                )}
                <div className="flex justify-between gap-6"><dt className="text-ink-400">Decided by</dt><dd className="font-medium capitalize">{auditLog.actionDecision.decidedBy ?? "—"}</dd></div>
                <div className="flex justify-between gap-6"><dt className="text-ink-400">Decided at</dt><dd className="font-medium">{new Date(auditLog.actionDecision.decidedAt).toLocaleString()}</dd></div>
              </dl>
            </div>
          ) : (
            <p className="text-[13px] text-ink-400">No action decision recorded for this diagnosis</p>
          )}
        </div>
      </Card>
    </div>
  );
}