import { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronLeft, Clock, Wrench, Shield, Zap, LayoutGrid, TrendingUp, ArrowRight, ActivitySquare, AlertCircle, ExternalLink, Thermometer, Gauge, Timer, MapPin } from "lucide-react";
import { fetchAnomalyDetail, fetchAuditLog, fetchActionDecision, recordActionDecision, ThermalApiError } from "../lib/api";
import type { LiveAnomalyDetail, LiveDiagnosisSummary, AuditLog, AuditLogToolCall, ActionDecision } from "../types";
import { Card, CardHeader, StatusBadge, SecondaryButton, PrimaryButton } from "../components/ui";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

function timeAgo(dateString: string): string {
  const diff = Date.now() - new Date(dateString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatAnomalyType(type: string): string {
  const map: Record<string, { label: string; icon: React.ReactNode }> = {
    thermal_anomaly: { label: "Thermal Anomaly", icon: <Thermometer size={16} className="text-red-500" /> },
    sensor_fault: { label: "Sensor Fault", icon: <AlertTriangle size={16} className="text-amber-500" /> },
    comfort_violation: { label: "Comfort Violation", icon: <Gauge size={16} className="text-blue-500" /> },
  };
  return map[type]?.label ?? type.replace(/_/g, " ");
}

function anomalyTypeIcon(type: string): React.ReactNode {
  const map: Record<string, React.ReactNode> = {
    thermal_anomaly: <Thermometer size={16} className="text-red-500" />,
    sensor_fault: <AlertTriangle size={16} className="text-amber-500" />,
    comfort_violation: <Gauge size={16} className="text-blue-500" />,
  };
  return map[type] ?? <ActivitySquare size={16} className="text-ink-400" />;
}

function formatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatToolName(tool: string): string {
  return tool.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface ResidualPoint {
  ts: string;
  residual_c: number;
}

function ResidualTraceChart({ data }: { data: ResidualPoint[] }) {
  if (!data || data.length === 0) return null;

  const chartData = useMemo(() =>
    data.map((d, i) => ({
      index: i,
      time: new Date(d.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      residual: d.residual_c,
    })),
    [data]
  );

  const maxResidual = Math.max(...chartData.map(d => Math.abs(d.residual)), 0.5);

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
        <XAxis dataKey="time" tick={{ fontSize: 11, fill: "#8c897d" }} axisLine={false} tickLine={false} interval={Math.max(1, Math.floor(chartData.length / 10))} />
        <YAxis
          domain={[-maxResidual * 1.2, maxResidual * 1.2]}
          tick={{ fontSize: 11, fill: "#8c897d" }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (active && payload && payload.length) {
              const d = payload[0].payload;
              return (
                <div className="bg-white p-3 rounded-lg border shadow-lg dark:bg-ink-900 dark:border-ink-700">
                  <p className="font-medium text-ink-800 dark:text-ink-100">{d.time}</p>
                  <p className="text-[13px] font-semibold text-red-600 dark:text-red-400">
                    Residual: {d.residual > 0 ? "+" : ""}{d.residual.toFixed(2)}°C
                  </p>
                </div>
              );
            }
            return null;
          }}
        />
        <Line
          type="monotone"
          dataKey="residual"
          stroke="#ee6c1f"
          strokeWidth={2}
          dot={({ payload }) => {
            if (!payload) return null;
            return (
              <circle
                cx={0}
                cy={0}
                r={4}
                fill={payload.residual > 0 ? "#ee6c1f" : "#1d9e75"}
                stroke="#fff"
                strokeWidth={1.5}
              />
            );
          }}
          isAnimationActive={false}
        />
        <line
          x1={0}
          x2={Number.MAX_SAFE_INTEGER}
          y1={0}
          y2={0}
          stroke="#8c897d"
          strokeWidth={1}
          strokeDasharray="5 5"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function getCauseDisplayName(cause: string): string {
  const causeMap: Record<string, string> = {
    "sensor_failure": "Sensor Failure",
    "hvac_underperformance": "HVAC Underperformance",
    "window_open_occupancy_gain": "Open Window / Door",
    "unmodelled_internal_gain": "Unmodelled Internal Gain",
    "calibration_drift": "Calibration Drift",
    "scheduling_error": "Scheduling Error",
    "unknown": "Unknown",
  };
  return causeMap[cause] ?? formatKey(cause);
}

function getActionDisplayName(actionType: string): string {
  const actionMap: Record<string, string> = {
    "inspection_required": "Inspection Required",
    "setpoint_change": "Increase Temperature Setpoint",
    "schedule_correction": "Schedule Correction",
  };
  return actionMap[actionType] ?? formatKey(actionType);
}



function getImpactDetails(diagnosis: LiveDiagnosisSummary): string[] {
  const impacts: string[] = [];
  if (typeof diagnosis.energyWastedKwh === "number") {
    impacts.push(`${diagnosis.energyWastedKwh.toFixed(2)} kWh estimated energy waste`);
  }
  const recurrence = diagnosis.recurrence ?? {};
  if (recurrence.seen_before) {
    impacts.push("Recurring issue in this room");
  }
  return impacts;
}

function getExpectedImpact(diagnosis: LiveDiagnosisSummary, deltaC: number | undefined): string {
  const basis = diagnosis.energyWastedBasis;
  if (basis === "mpc_counterfactual" && typeof diagnosis.energyWastedKwh === "number") {
    const delta = typeof deltaC === "number" ? `${deltaC > 0 ? "+" : ""}${deltaC.toFixed(1)}°C` : "the proposed setpoint change";
    return `Correcting the setpoint by ${delta} targets the ${diagnosis.energyWastedKwh.toFixed(1)} kWh wasted versus MPC-optimal operation, reducing future energy waste and restoring comfort.`;
  }
  if (basis === "no_sensor_data" || basis === "no_mpc_counterfactual") {
    return "Energy waste could not be quantified for this anomaly (no usable sensor / MPC baseline data); the setpoint correction targets the observed deviation.";
  }
  return "Applying the setpoint correction reduces the residual deviation and improves occupant comfort.";
}

function EvidenceTimeline({ evidence, auditLog }: { evidence: string[]; auditLog: AuditLog | null }) {
  const stepLabels: Record<string, { label: string; icon: React.ReactNode }> = {
    get_sensor_history: { label: "Sensor History", icon: <TrendingUp size={16} className="text-primary-600" /> },
    get_calendar: { label: "Occupancy Calendar", icon: <Clock size={16} className="text-primary-600" /> },
    get_hvac_logs: { label: "HVAC Logs", icon: <Zap size={16} className="text-primary-600" /> },
    get_mpc_trajectory: { label: "MPC Trajectory", icon: <TrendingUp size={16} className="text-primary-600" /> },
    get_building_context: { label: "Building Context", icon: <Shield size={16} className="text-primary-600" /> },
    get_similar_anomalies: { label: "Historical Anomalies", icon: <Clock size={16} className="text-primary-600" /> },
    check_neighboring_zones: { label: "Neighboring Zones", icon: <LayoutGrid size={16} className="text-primary-600" /> },
    llm_reason: { label: "Diagnostic Agent", icon: <CheckCircle2 size={16} className="text-green-600" /> },
    validate_output: { label: "Validation", icon: <CheckCircle2 size={16} className="text-green-600" /> },
    supervisor_decision: { label: "Supervisor Decision", icon: <Shield size={16} className="text-green-600" /> },
  };

  function generateDescription(tool: string, toolCall: AuditLogToolCall | undefined): string {
    if (!toolCall) return "Tool was called but no data returned";
    if (Object.keys(toolCall.result).length === 0 && toolCall.resultSummary) {
      const s = toolCall.resultSummary.replace(/^[a-z_]+:\s*/, "");
      const takeaway: Record<string, (s: string) => string> = {
        get_sensor_history: (x) => x,
        get_calendar: (x) => x.replace(/^(\d+) observed occupancy block\(s\) over (\d+) days, first (.+), last (.+)$/, (_, n, d) => `${n} occupancy block${n === "1" ? "" : "s"} observed across ${d} day${d === "1" ? "" : "s"}`),
        get_hvac_logs: (x) => x.replace(/^(\d+) HVAC state change\(s\), current state (\w+), cooling was active ~([\d.]+)h of the ([\d.]+)h window/, (_, _n, st, c, w) => `Cooling ran ${c}h of a ${w}h window (current state: ${st})`),
        get_mpc_trajectory: (x) => x.replace(/^MPC plan of (\d+) slots, latest setpoint ([\d.]+) C vs predicted ([\d.]+) C$/, (_, n, sp, pr) => `MPC scheduled ${n} slots — latest setpoint ${sp}°C (predicted ${pr}°C)`),
        get_building_context: (x) => x.replace(/^room (.+?) \(([\d.]+) m2, ([\d.]+) m3, (.+?)\), RC model RMSE (.+)$/, (_, l, a, v, o, rmse) => `Room ${l} (${a} m², ${v} m³, ${o}) — model RMSE ${rmse}`),
        get_similar_anomalies: (x) => x.replace(/^(\d+) similar prior anomal\w+ in (\d+) days/, (_, n, d) => `${n} similar past anomal${n === "1" ? "y" : "ies"} in ${d} days`),
        check_neighboring_zones: (x) => x.replace(/^(\d+) adjacent zone\(s\) found$/, (_, n) => `Checked ${n} adjacent zone${n === "1" ? "" : "s"}`),
      };
      return (takeaway[tool]?.(s) ?? s);
    }

    const result = toolCall.result;
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

  function extractFacts(tool: string, toolCall: AuditLogToolCall | undefined): string[] {
    const result = toolCall?.result;
    const summary = toolCall?.resultSummary ?? "";

    if (tool === "get_sensor_history") {
      const series = (result?.series as Array<{ temp_measured_c: number }> | undefined) ?? [];
      const temps = series.map(s => s.temp_measured_c).filter((t): t is number => t !== null && t !== undefined);
      if (temps.length > 0) {
        const min = Math.min(...temps);
        const max = Math.max(...temps);
        const last = temps[temps.length - 1];
        const trend = last > min + 0.3 ? "rising" : last < max - 0.3 ? "falling" : "stable";
        const facts = [`${temps.length} readings`, `${min.toFixed(1)} → ${max.toFixed(1)}°C`];
        facts.push(`latest ${last.toFixed(1)}°C · ${trend}`);
        const occupied = series.some(s => (s as { occupied?: boolean }).occupied);
        facts.push(occupied ? "occupied" : "unoccupied");
        return facts;
      }
      const m = summary.match(/(\d+) readings, T in \[([\d.]+), ([\d.]+)\] C, latest ([\d.]+) C \((\w+)\), occupied during window: (\w+)/);
      if (m) {
        const facts = [`${m[1]} readings`, `${m[2]} → ${m[3]}°C`];
        facts.push(`latest ${m[4]}°C · ${m[5]}`);
        facts.push(m[6] === "yes" ? "occupied" : "unoccupied");
        return facts;
      }
      return [];
    }
    if (tool === "get_calendar") {
      const blocks = (result?.occupancy_blocks_observed as Array<{ start: string; end: string }> | undefined) ?? [];
      if (blocks.length > 0) {
        const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        return [`${blocks.length} occupancy block${blocks.length === 1 ? "" : "s"}`, `${fmt(blocks[0].start)} → ${fmt(blocks[blocks.length - 1].end)}`];
      }
      const m = summary.match(/(\d+) observed occupancy block\(s\) over (\d+) days, first (.+), last (.+)/);
      if (m) {
        const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        return [`${m[1]} occupancy block${m[1] === "1" ? "" : "s"}`, `${fmt(m[3])} → ${fmt(m[4])}`];
      }
      return [];
    }
    if (tool === "get_hvac_logs") {
      const windowSec = result?.window_seconds as number | undefined;
      const coolingSec = result?.cooling_seconds as number | undefined;
      const changes = (result?.state_changes as Array<{ state: string }> | undefined) ?? [];
      const lastState = changes.length > 0 ? changes[changes.length - 1].state : "";
      if (changes.length > 0 && result) {
        const facts = [`${result.changes_total} state change${result.changes_total === 1 ? "" : "s"}`, `current: ${lastState}`];
        if (windowSec && windowSec > 0 && coolingSec !== undefined) {
          const pct = Math.round((coolingSec / windowSec) * 100);
          facts.push(`cooling ${(coolingSec / 3600).toFixed(1)}h / ${(windowSec / 3600).toFixed(1)}h (${pct}%)`);
        }
        return facts;
      }
      const m = summary.match(/(\d+) HVAC state change\(s\), current state (\w+), cooling was active ~([\d.]+)h of the ([\d.]+)h window/);
      if (m) {
        const pct = Math.round((parseFloat(m[3]) / parseFloat(m[4])) * 100);
        return [`${m[1]} state change${m[1] === "1" ? "" : "s"}`, `current: ${m[2]}`, `cooling ${m[3]}h / ${m[4]}h (${pct}%)`];
      }
      return [];
    }
    if (tool === "get_mpc_trajectory") {
      const slots = (result?.trajectory as Array<{ setpoint_c: number; predicted_temp_c: number }> | undefined) ?? [];
      if (slots.length > 0) {
        const avgSetpoint = slots.reduce((sum, s) => sum + s.setpoint_c, 0) / slots.length;
        return [`${slots.length} slots`, `avg setpoint ${avgSetpoint.toFixed(1)}°C`];
      }
      const m = summary.match(/MPC plan of (\d+) slots, latest setpoint ([\d.]+) C vs predicted ([\d.]+) C/);
      if (m) return [`${m[1]} slots`, `latest ${m[2]}°C (pred ${m[3]}°C)`];
      return [];
    }
    if (tool === "get_building_context") {
      const model = (result?.active_model as { rmse_validation?: number } | undefined) ?? {};
      const facts: string[] = [];
      if (result?.room_label) facts.push(String(result.room_label));
      if (result?.area_m2) facts.push(`${result.area_m2} m²`);
      if (model.rmse_validation) facts.push(`RMSE ${model.rmse_validation.toFixed(2)}°C`);
      if (facts.length > 0) return facts;
      const m = summary.match(/room (.+?) \(([\d.]+) m2, ([\d.]+) m3, (.*?)\), RC model RMSE (\S+)/);
      if (m) return [`${m[1]}`, `${m[2]} m²`, `RMSE ${m[5]}`];
      return [];
    }
    if (tool === "get_similar_anomalies") {
      const priors = (result?.prior_anomalies as Array<{ resolved_cause?: string }> | undefined) ?? [];
      if (priors.length > 0) {
        const facts = [`${priors.length} prior`];
        const causes = [...new Set(priors.map(p => p.resolved_cause).filter(Boolean))] as string[];
        if (causes.length > 0) facts.push(causes.join(", "));
        return facts;
      }
      const m = summary.match(/(\d+) similar prior anomal\w+ in (\d+) days/);
      if (m) {
        const facts = [`${m[1]} prior in ${m[2]} days`];
        const causeMatch = summary.match(/past causes: (.+)$/);
        if (causeMatch) {
          const cleaned = causeMatch[1].replace(/'/g, "").replace(/[\[\]]/g, "");
          facts.push(cleaned);
        }
        return facts;
      }
      return [];
    }
    if (tool === "check_neighboring_zones") {
      const neighbors = (result?.neighbors as Array<{ latest_temp_c?: number }> | undefined) ?? [];
      if (neighbors.length > 0) {
        const withTemp = neighbors.filter(n => n.latest_temp_c !== null && n.latest_temp_c !== undefined);
        return [`${neighbors.length} zones`, `${withTemp.length} with sensor data`];
      }
      const m = summary.match(/(\d+) adjacent zone\(s\) found/);
      if (m) return [`${m[1]} zones`];
      return [];
    }
    return [];
  }

  const toolCallsByTool = new Map<string, AuditLogToolCall>();
  auditLog?.toolCalls.forEach(tc => {
    if (!toolCallsByTool.has(tc.tool)) {
      toolCallsByTool.set(tc.tool, tc);
    }
  });

  return (
    <div className="space-y-6">
      {evidence.map((e, i) => {
        const [tool, ...rest] = e.split(":");
        rest.join(":").trim();
        const step = stepLabels[tool] ?? { label: formatToolName(tool), icon: <ArrowRight size={16} className="text-primary-600" /> };
        const toolCall = toolCallsByTool.get(tool);
        const description = generateDescription(tool, toolCall);
        const isLast = i === evidence.length - 1;
        return (
          <div key={i} className="relative flex gap-4">
            <div className="flex flex-col items-center">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                {step.icon}
              </div>
              {!isLast && <div className="mt-2 w-0.5 h-full bg-ink-200 dark:bg-ink-700" />}
            </div>
            <div className="flex-1 pt-1">
              <p className="font-medium text-ink-800 dark:text-ink-100">{step.label}</p>
              <p className="mt-1 text-[13px] text-ink-600 dark:text-ink-300">{description}</p>
              {toolCall && extractFacts(tool, toolCall).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {extractFacts(tool, toolCall).map((fact, fi) => (
                    <span key={fi} className="rounded-md bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                      {fact}
                    </span>
                  ))}
                </div>
              )}
              {toolCall && (
                <p className="mt-1.5 text-[11px] text-ink-400 font-mono">
                  {new Date(toolCall.timestamp).toLocaleTimeString()} · {Object.keys(toolCall.args).length} arg(s)
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function DiagnosisDetail() {
  const { buildingId = "esi-algiers", anomalyId = "" } = useParams();
  const [anomaly, setAnomaly] = useState<LiveAnomalyDetail | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(false);
  const [actionDecision, setActionDecision] = useState<ActionDecision | null>(null);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!anomaly?.diagnosis) return;
    const controller = new AbortController();
    setAuditLoading(true);
    fetchAuditLog(anomaly.anomalyId, controller.signal)
      .then(setAuditLog)
      .catch(() => setAuditLog(null))
      .finally(() => {
        if (!controller.signal.aborted) setAuditLoading(false);
      });
    return () => controller.abort();
  }, [anomaly]);

  useEffect(() => {
    if (!anomaly?.diagnosis) return;
    const controller = new AbortController();
    fetchActionDecision(anomaly.anomalyId, controller.signal)
      .then(setActionDecision)
      .catch(() => setActionDecision(null));
    return () => controller.abort();
  }, [anomaly]);

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
  const actionType = (diagnosis?.proposedAction?.type as string) ?? "unknown";
  const deltaC = (diagnosis?.proposedAction?.delta_c as number | undefined);
  

  const durationHours = anomaly.openedAt && anomaly.closedAt
    ? ((new Date(anomaly.closedAt).getTime() - new Date(anomaly.openedAt).getTime()) / 3600000).toFixed(1)
    : anomaly.openedAt
      ? ((Date.now() - new Date(anomaly.openedAt).getTime()) / 3600000).toFixed(1)
      : "—";

  return (
    <div className="mx-auto max-w-4xl">
      <nav className="mb-4 flex items-center gap-2 text-[13px] text-ink-400" aria-label="Breadcrumb">
        <Link to={`/b/${buildingId}`} className="hover:text-primary-600">Buildings</Link>
        <ChevronLeft size={14} />
        <Link to={`/b/${buildingId}/anomalies`} className="hover:text-primary-600">Anomalies</Link>
        <ChevronLeft size={14} />
        <span className="text-ink-600 dark:text-ink-300">{anomaly.roomLabel}</span>
      </nav>

      {/* ===== HEADER ===== */}
      <Card className="mb-6 p-5 bg-gradient-to-r from-ink-50 to-primary-50 dark:from-ink-900/50 dark:to-primary-900/20 border-ink-200 dark:border-ink-800">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-3 mb-2">
              <div className="flex items-center gap-2 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 px-3 py-1.5 rounded-full">
                {anomalyTypeIcon(anomaly.anomalyType)}
                <span className="text-[13px] font-medium">{formatAnomalyType(anomaly.anomalyType)}</span>
              </div>
              <span className="text-ink-400 dark:text-ink-500">•</span>
              <span className="text-[13px] text-ink-500 dark:text-ink-400 flex items-center gap-1">
                <Timer size={14} /> {timeAgo(anomaly.openedAt)}
              </span>
              {anomaly.closedAt && (
                <>
                  <span className="text-ink-400 dark:text-ink-500">•</span>
                  <span className="text-[13px] text-ink-500 dark:text-ink-400 flex items-center gap-1">
                    <CheckCircle2 size={14} className="text-green-500" /> Resolved {timeAgo(anomaly.closedAt)}
                  </span>
                </>
              )}
            </div>
            <h1 className="text-[24px] font-medium text-ink-800 dark:text-ink-100 truncate">
              {anomaly.roomLabel}
            </h1>
            <p className="mt-1 text-[14px] text-ink-500 dark:text-ink-400 flex items-center gap-1">
              <MapPin size={14} /> Floor {anomaly.floorLevel} · Anomaly #{anomaly.anomalyId}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge status={anomaly.severity} />
              <StatusBadge status={anomaly.status} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:ml-6 shrink-0">
            <div className="p-3 rounded-xl bg-white/70 dark:bg-ink-800/70 border border-ink-200 dark:border-ink-700">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400 flex items-center gap-1 justify-center">
                <Thermometer size={12} /> Residual
              </p>
              <p className="mt-1 text-xl font-semibold text-red-600 dark:text-red-400">
                {anomaly.residualC !== null ? `${anomaly.residualC > 0 ? "+" : ""}${anomaly.residualC.toFixed(2)}°C` : "—"}
              </p>
              {anomaly.thresholdC !== null && anomaly.residualC !== null && (
                <p className="mt-1 text-[11px] text-ink-400">
                  {Math.abs(anomaly.residualC / anomaly.thresholdC).toFixed(1)}× threshold
                </p>
              )}
            </div>
            <div className="p-3 rounded-xl bg-white/70 dark:bg-ink-800/70 border border-ink-200 dark:border-ink-700">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400 flex items-center gap-1 justify-center">
                <Gauge size={12} /> Threshold
              </p>
              <p className="mt-1 text-xl font-semibold text-ink-800 dark:text-ink-100">
                {anomaly.thresholdC?.toFixed(2) ?? "—"}°C
              </p>
            </div>
            <div className="p-3 rounded-xl bg-white/70 dark:bg-ink-800/70 border border-ink-200 dark:border-ink-700">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400 flex items-center gap-1 justify-center">
                <Clock size={12} /> Duration
              </p>
              <p className="mt-1 text-xl font-semibold text-ink-800 dark:text-ink-100">{durationHours}h</p>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-[13px] text-ink-500 dark:text-ink-400 border-t border-ink-200/50 dark:border-ink-700/50 pt-4">
          <span className="flex items-center gap-1">
            <Clock size={14} /> Opened: {new Date(anomaly.openedAt).toLocaleString()}
          </span>
          {anomaly.closedAt && (
            <span className="flex items-center gap-1">
              <CheckCircle2 size={14} className="text-green-500" /> Closed: {new Date(anomaly.closedAt).toLocaleString()}
            </span>
          )}
        </div>
      </Card>

      {/* ===== RESIDUAL TRACE CHART ===== */}
      {anomaly.residualTrace && anomaly.residualTrace.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Residual Trace" subtitle="Temperature deviation (measured - predicted) over the anomaly window" />
          <div className="px-5 pb-5">
            <ResidualTraceChart data={anomaly.residualTrace} />
            <div className="mt-3 flex items-center gap-4 text-[12px] text-ink-400">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-red-500" />
                Positive = overheating
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-teal-500" />
                Negative = overcooling
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-5 h-0.5 bg-ink-400 border-t-2 border-dashed" />
                Zero threshold
              </span>
            </div>
          </div>
        </Card>
      )}

      {diagnosis ? (
        <>
          {/* ===== CONFIDENCE SIGNALS ===== */}
          {diagnosis.confidenceSignals && diagnosis.confidenceSignals.length > 0 && (
            <Card className="mb-6">
              <CardHeader title="Confidence Signals" subtitle="Evidence-weighted signals corroborating the diagnosed cause" />
              <div className="px-5 pb-5">
                <div className="flex flex-wrap gap-2">
                  {diagnosis.confidenceSignals.map((signal, i) => (
                    <span key={i} className="inline-flex items-center px-3 py-1 rounded-full text-[12px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      {formatKey(signal)}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-[13px] text-ink-600 dark:text-ink-300">
                  {diagnosis.confidenceSignals.length} corroborating signal{diagnosis.confidenceSignals.length !== 1 ? "s" : ""} → {diagnosis.causeConfidence.charAt(0).toUpperCase() + diagnosis.causeConfidence.slice(1)} confidence
                </p>
              </div>
            </Card>
          )}

          {/* ===== AI DIAGNOSIS ===== */}
          <Card className="mb-6">
            <CardHeader title="AI Diagnosis" />
            <div className="px-5 pb-5 space-y-4">
              <div className="rounded-xl bg-ink-50 p-5 dark:bg-ink-900/50 border-l-4 border-primary-500">
                <p className="text-[15px] leading-relaxed text-ink-800 dark:text-ink-200">{diagnosis.message}</p>
              </div>
              <div className="flex items-center gap-4">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium ${
                  diagnosis.causeConfidence === "high" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                  diagnosis.causeConfidence === "medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                  diagnosis.causeConfidence === "low" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                  "bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-400"
                }`}>
                  Confidence: {diagnosis.causeConfidence.charAt(0).toUpperCase() + diagnosis.causeConfidence.slice(1)}
                </span>
                <span className="text-[12px] text-ink-400">Diagnosed {new Date(diagnosis.createdAt).toLocaleString()}</span>
              </div>
            </div>
          </Card>

          {/* ===== CAUSE & IMPACT ===== */}
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader title="Root Cause" />
              <div className="px-5 pb-5">
                <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/30">
                  <ActivitySquare size={24} className="text-amber-600 dark:text-amber-400" />
                  <p className="text-[16px] font-medium text-ink-800 dark:text-ink-100">
                    {getCauseDisplayName(diagnosis.cause)}
                  </p>
                </div>
              </div>
            </Card>
            <Card>
              <CardHeader title="Impact" />
              <div className="px-5 pb-5 pt-4">
                <ul className="space-y-3">
                  {getImpactDetails(diagnosis).map((impact, i) => (
                    <li key={i} className="flex items-start gap-3 text-[13px] text-ink-700 dark:text-ink-200">
                      <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-500" />
                      <span className="leading-relaxed">{impact}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          </div>

          {/* ===== EVIDENCE TIMELINE ===== */}
          <Card className="mb-6">
            <CardHeader title="Evidence" subtitle="Investigation steps the diagnostic agent performed" />
            <div className="p-5">
              <EvidenceTimeline evidence={diagnosis.evidence} auditLog={auditLog} />
            </div>
          </Card>

          {/* ===== RECOMMENDED ACTION ===== */}
          <Card className="mb-6">
            <CardHeader title="Recommended Action" />
            <div className="px-5 pb-5">
              <div className="rounded-xl border border-primary-200 bg-primary-50 p-5 dark:border-primary-900/30 dark:bg-primary-900/20">
                <div className="flex items-center gap-3 mb-4">
                  <Wrench size={24} className="text-primary-600 dark:text-primary-400" />
                  <div>
                    <p className="text-[12px] font-medium uppercase tracking-wide text-primary-700 dark:text-primary-400">Action Type</p>
                    <p className="text-[16px] font-medium text-primary-800 dark:text-primary-300">
                      {getActionDisplayName(actionType)}
                    </p>
                  </div>
                </div>
                {typeof deltaC === "number" && (
                  <div className="mb-4 p-3 rounded-lg bg-white/50 dark:bg-ink-800/50">
                    <p className="text-[12px] font-medium uppercase tracking-wide text-ink-400">Setpoint Correction</p>
                    <p className="mt-1 text-[20px] font-semibold text-primary-700 dark:text-primary-300">
                      {deltaC > 0 ? "+" : ""}{deltaC.toFixed(1)}°C
                    </p>
                  </div>
                )}
                <div className="mb-4 p-3 rounded-lg bg-white/50 dark:bg-ink-800/50">
                  <p className="text-[12px] font-medium uppercase tracking-wide text-ink-400">Expected Impact</p>
                  <p className="mt-1 text-[13px] text-ink-700 dark:text-ink-200">
                    {getExpectedImpact(diagnosis, deltaC)}
                  </p>
                </div>
                <div className="flex gap-3">
                  {actionDecision ? (
                    <div className={`flex-1 rounded-xl border px-4 py-3 text-center text-[13px] font-medium ${
                      actionDecision.decision === "applied"
                        ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900/30 dark:bg-green-900/20 dark:text-green-400"
                        : "border-red-200 bg-red-50 text-red-700 dark:border-red-900/30 dark:bg-red-900/20 dark:text-red-400"
                    }`}>
                      {actionDecision.decision === "applied" ? "Action Applied" : "Action Rejected"}
                      <span className="block mt-0.5 text-[11px] font-normal text-ink-500 dark:text-ink-400">
                        {actionDecision.decidedBy} · {new Date(actionDecision.decidedAt).toLocaleString()}
                      </span>
                    </div>
                  ) : (
                    <>
                      <PrimaryButton
                        className="flex-1"
                        disabled={decisionLoading}
                        onClick={() => {
                          setDecisionError(null);
                          setDecisionLoading(true);
                          recordActionDecision(anomaly.anomalyId, "applied")
                            .then(setActionDecision)
                            .catch((err: unknown) => setDecisionError(err instanceof ThermalApiError ? err.message : "Failed to record decision"))
                            .finally(() => setDecisionLoading(false));
                        }}
                      >
                        {decisionLoading ? "Recording…" : "Apply Action"}
                      </PrimaryButton>
                      <SecondaryButton
                        className="flex-1"
                        disabled={decisionLoading}
                        onClick={() => {
                          setDecisionError(null);
                          setDecisionLoading(true);
                          recordActionDecision(anomaly.anomalyId, "rejected")
                            .then(setActionDecision)
                            .catch((err: unknown) => setDecisionError(err instanceof ThermalApiError ? err.message : "Failed to record decision"))
                            .finally(() => setDecisionLoading(false));
                        }}
                      >
                        Reject
                      </SecondaryButton>
                    </>
                  )}
                </div>
                {decisionError && (
                  <p className="mt-3 text-[12px] text-red-600 dark:text-red-400">Could not record decision: {decisionError}</p>
                )}
              </div>
            </div>
          </Card>

          {/* ===== SUPERVISOR DECISION ===== */}
          <Card className="mb-6">
            <CardHeader title="Supervisor Decision" subtitle="Deterministic safety gate — not made by the LLM" />
            <div className="px-5 pb-5">
              <div className="rounded-xl border border-green-200 bg-green-50 p-5 dark:border-green-900/30 dark:bg-green-900/20">
                <div className="flex items-center gap-3 mb-3">
                  <Shield size={24} className="text-green-600 dark:text-green-400" />
                  <div>
                    <p className="text-[12px] font-medium uppercase tracking-wide text-green-700 dark:text-green-400">
                      {diagnosis.supervisorDecision === "autonomous" ? "AUTONOMOUS ACTION" : 
                       diagnosis.supervisorDecision === "human_alert" ? "HUMAN ALERT REQUIRED" : "LOG ONLY"}
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 text-[13px]">
                  <div>
                    <p className="text-ink-400">Decision Engine</p>
                    <p className="font-medium text-ink-800 dark:text-ink-100">Rule-based supervisor</p>
                  </div>
                  <div>
                    <p className="text-ink-400">Reason</p>
                    <p className="font-medium text-ink-800 dark:text-ink-100">
                      {auditLog?.supervisorDecision?.reason
                        ? String(auditLog.supervisorDecision.reason)
                        : diagnosis.supervisorDecision === "autonomous" 
                          ? "Action is within configured safety limits (|ΔC| ≤ 2.0°C, cause eligible for autonomous action)."
                          : diagnosis.supervisorDecision === "human_alert"
                          ? "Cause requires human inspection or action exceeds safety limits."
                          : "Same room + cause diagnosed within 30-day cooldown — re-alert suppressed."}
                    </p>
                  </div>
                  <div>
                    <p className="text-ink-400">LLM Role</p>
                    <p className="font-medium text-ink-800 dark:text-ink-100">Diagnosis (cause, evidence, confidence)</p>
                  </div>
                  <div>
                    <p className="text-ink-400">Supervisor Role</p>
                    <p className="font-medium text-ink-800 dark:text-ink-100">Final deterministic decision</p>
                  </div>
                  <div>
                    <p className="text-ink-400">MPC Role</p>
                    <p className="font-medium text-ink-800 dark:text-ink-100">Optimization (setpoint computation)</p>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* ===== AGENT ACTIVITY / AUDIT TRAIL ===== */}
          <Card className="mb-6">
            <CardHeader title="Agent Activity / Audit Trail" subtitle={auditLoading ? "Loading…" : auditLog ? `Last run: ${new Date(auditLog.invokedAt).toLocaleString()}` : "No audit log available"} />
            <div className="px-5 pb-5">
              <div className="space-y-3">
                {auditLog?.toolCalls.map((tc, i) => (
                  <div key={i} className="flex items-center gap-3 text-[13px]">
                    <CheckCircle2 size={16} className="shrink-0 text-green-500" />
                    <span className="text-ink-700 dark:text-ink-200">{formatToolName(tc.tool)}</span>
                    <span className="ml-auto text-[11px] text-ink-400 font-mono">
                      {new Date(tc.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
                {(!auditLog || auditLog.toolCalls.length === 0) && !auditLoading && (
                  <p className="text-[13px] text-ink-400">No audit log available for this diagnosis</p>
                )}
              </div>
              {auditLog && (
                <Link
                  to={`/b/${buildingId}/audit?anomalyId=${anomaly.anomalyId}`}
                  className="mt-4 inline-flex items-center gap-1 text-sm text-primary-600 hover:underline"
                >
                  View full audit log
                  <ExternalLink size={14} />
                </Link>
              )}
            </div>
          </Card>

          {/* ===== RECURRENCE ===== */}
          {seenBefore && (
            <Card className="mb-6 border-amber-200 dark:border-amber-900/30">
              <div className="p-5">
                <div className="flex items-start gap-3">
                  <Clock size={20} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="flex-1">
                    <p className="text-[12px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">Recurring Issue</p>
                    <p className="mt-1 text-[13px] text-amber-800 dark:text-amber-300">This room + cause was seen before.</p>
                    {typeof recurrence.last_occurrence === "string" && (
                      <p className="mt-1.5 text-[12px] text-amber-700 dark:text-amber-400">
                        Last occurrence: {new Date(recurrence.last_occurrence).toLocaleString()}
                      </p>
                    )}
                    {typeof recurrence.long_term_recommendation === "string" && recurrence.long_term_recommendation && (
                      <p className="mt-1.5 text-[12px] text-amber-700 dark:text-amber-400">
                        {recurrence.long_term_recommendation}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          )}

        </>
      ) : (
        <div className="space-y-6">
          <Card className="mb-6 p-6 border-amber-200 bg-amber-50 dark:border-amber-900/30 dark:bg-amber-900/20">
            <div className="flex items-center gap-3">
              <AlertCircle size={24} className="text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-[14px] font-medium text-amber-800 dark:text-amber-300">Anomaly Not Yet Diagnosed</p>
                <p className="mt-1 text-[13px] text-amber-700 dark:text-amber-400">
                  The orchestrator runs the diagnostic agent on its 15-minute cycle. This anomaly was detected but has not yet been processed.
                </p>
              </div>
            </div>
          </Card>

          {/* ===== ANOMALY DETAILS ===== */}
          <Card className="mb-6">
            <CardHeader title="Anomaly Details" />
            <div className="px-5 pb-5 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[12px] font-medium uppercase tracking-wide text-ink-400">Anomaly Type</p>
                <p className="mt-1 text-[14px] font-medium text-ink-800 dark:text-ink-100 capitalize">{anomaly.anomalyType.replace(/_/g, " ")}</p>
              </div>
              <div>
                <p className="text-[12px] font-medium uppercase tracking-wide text-ink-400">Room</p>
                <p className="mt-1 text-[14px] font-medium text-ink-800 dark:text-ink-100">{anomaly.roomLabel} (Floor {anomaly.floorLevel})</p>
              </div>
              <div>
                <p className="text-[12px] font-medium uppercase tracking-wide text-ink-400">Detected</p>
                <p className="mt-1 text-[14px] font-medium text-ink-800 dark:text-ink-100">{new Date(anomaly.openedAt).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[12px] font-medium uppercase tracking-wide text-ink-400">Status</p>
                <p className="mt-1 text-[14px] font-medium text-ink-800 dark:text-ink-100">
                  <StatusBadge status={anomaly.status} />
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-[12px] font-medium uppercase tracking-wide text-ink-400">Severity</p>
                <p className="mt-1 text-[14px] font-medium text-ink-800 dark:text-ink-100">
                  <StatusBadge status={anomaly.severity} />
                </p>
              </div>
              {anomaly.residualC !== null && (
                <div className="sm:col-span-2">
                  <p className="text-[12px] font-medium uppercase tracking-wide text-ink-400">Residual (Measured - Predicted)</p>
                  <p className="mt-1 text-[18px] font-semibold text-red-600 dark:text-red-400">
                    {anomaly.residualC > 0 ? "+" : ""}{anomaly.residualC.toFixed(2)}°C
                  </p>
                  {anomaly.thresholdC !== null && (
                    <p className="mt-1 text-[13px] text-ink-500 dark:text-ink-400">
                      Detection threshold: {anomaly.thresholdC.toFixed(2)}°C
                      {anomaly.residualC > anomaly.thresholdC && " — EXCEEDED"}
                    </p>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* ===== RESIDUAL TRACE CHART ===== */}
          {anomaly.residualTrace && anomaly.residualTrace.length > 0 && (
            <Card className="mb-6">
              <CardHeader title="Residual Trace" subtitle="Temperature deviation (measured - predicted) over the anomaly window" />
              <div className="px-5 pb-5">
                <ResidualTraceChart data={anomaly.residualTrace} />
                <div className="mt-3 flex items-center gap-4 text-[12px] text-ink-400">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-red-500" />
                    Positive = overheating
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-teal-500" />
                    Negative = overcooling
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-5 h-0.5 bg-ink-400 border-t-2 border-dashed" />
                    Zero threshold
                  </span>
                </div>
              </div>
            </Card>
          )}

          <Card className="mb-6 p-6 text-center text-[14px] text-ink-400">
            Not diagnosed yet — Orchestrator will call the diagnostic agent on its next cycle.
          </Card>
        </div>
      )}
    </div>
  );
}