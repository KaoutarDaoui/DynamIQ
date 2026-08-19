// Human-readable labels for Agent 3's fixed enums. The frontend must never
// invent cause/action names — it only translates the exact backend taxonomy
// value into a clean term for supervisors.

// The complete Agent 3 cause taxonomy (mirrors constants.VALID_CAUSES).
export const CAUSES: string[] = [
  "sensor_failure",
  "hvac_underperformance",
  "window_open_occupancy_gain",
  "unmodelled_internal_gain",
  "calibration_drift",
  "scheduling_error",
  "unknown",
];

export const CAUSE_LABELS: Record<string, string> = {
  hvac_underperformance: "HVAC unable to cool the room",
  window_open_occupancy_gain: "Open window / occupancy heat gain",
  sensor_failure: "Sensor failure",
  unmodelled_internal_gain: "Unexpected internal heat source",
  calibration_drift: "Model calibration drift",
  scheduling_error: "Incorrect HVAC schedule",
  unknown: "Cause unknown — inspection required",
};

export function causeLabel(cause: string | null | undefined): string {
  if (!cause) return "—";
  return CAUSE_LABELS[cause] ?? cause.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const ACTION_LABELS: Record<string, string> = {
  setpoint_change: "Temporary setpoint change",
  schedule_correction: "Schedule correction",
  inspection_required: "Manual inspection required",
  shutdown: "Shutdown",
  lockout: "Equipment lockout",
  no_action: "No action needed",
};

export function actionLabel(action: string | null | undefined): string {
  if (!action) return "—";
  return ACTION_LABELS[action] ?? action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const DECISION_LABELS: Record<string, string> = {
  autonomous: "Handled autonomously",
  human_alert: "Supervisor action required",
  log_only: "Logged only",
};

export function decisionLabel(decision: string | null | undefined): string {
  if (!decision) return "—";
  return DECISION_LABELS[decision] ?? decision.replace("_", " ");
}