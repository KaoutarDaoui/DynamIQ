import type { LiveAlert, LiveAnomalyDetail, LiveAnomalyOverview, LiveDiagnosisOverview, MpcRoomSummary, MpcSchedule, ReportsSummary, ThermalModelRoom } from "../types";

const THERMAL_API_BASE = import.meta.env.VITE_THERMAL_API_URL ?? "http://localhost:8001";

// Only the ESI Algiers pilot has real Agent 1-4 data in Supabase right now;
// every other building in this UI is still a Portfolio-page mock.
const BUILDING_ID_MAP: Record<string, string> = { "esi-algiers": "1" };

interface ThermalModelRoomApiResponse {
  room_id: string;
  room_label: string;
  floor_id: string;
  floor_level: number;
  area_m2: number;
  is_instrumented: boolean;
  is_calibrated: boolean;
  version: number | null;
  r_lumped_k_per_w: number | null;
  c_lumped_j_per_k: number | null;
  rmse_validation_c: number | null;
  anomaly_threshold_c: number | null;
  data_window_start: string | null;
  data_window_end: string | null;
  calibrated_at: string | null;
}

export class ThermalApiError extends Error {}

async function _get(path: string, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(`${THERMAL_API_BASE}${path}`, { signal });
  } catch {
    throw new ThermalApiError(`Could not reach the Thermal Agent API at ${THERMAL_API_BASE}`);
  }
}

export async function fetchThermalModels(buildingId: string, signal?: AbortSignal): Promise<ThermalModelRoom[]> {
  const realBuildingId = BUILDING_ID_MAP[buildingId] ?? buildingId;
  const res = await _get(`/buildings/${encodeURIComponent(realBuildingId)}/thermal-models`, signal);
  if (res.status === 404) return [];
  if (!res.ok) throw new ThermalApiError(`Thermal Agent API returned ${res.status}`);
  const data: ThermalModelRoomApiResponse[] = await res.json();
  return data.map((r) => ({
    roomId: r.room_id,
    roomLabel: r.room_label,
    floorId: r.floor_id,
    floorLevel: r.floor_level,
    areaM2: r.area_m2,
    isInstrumented: r.is_instrumented,
    isCalibrated: r.is_calibrated,
    version: r.version,
    rLumpedKPerW: r.r_lumped_k_per_w,
    cLumpedJPerK: r.c_lumped_j_per_k,
    rmseValidationC: r.rmse_validation_c,
    anomalyThresholdC: r.anomaly_threshold_c,
    dataWindowStart: r.data_window_start,
    dataWindowEnd: r.data_window_end,
    calibratedAt: r.calibrated_at,
  }));
}

interface MpcRoomSummaryApiResponse {
  room_id: string;
  room_label: string;
  floor_level: number;
  latest_solved_at: string;
}

export async function fetchMpcRooms(buildingId: string, signal?: AbortSignal): Promise<MpcRoomSummary[]> {
  const realBuildingId = BUILDING_ID_MAP[buildingId] ?? buildingId;
  const res = await _get(`/buildings/${encodeURIComponent(realBuildingId)}/mpc-rooms`, signal);
  if (res.status === 404) return [];
  if (!res.ok) throw new ThermalApiError(`Thermal Agent API returned ${res.status}`);
  const data: MpcRoomSummaryApiResponse[] = await res.json();
  return data.map((r) => ({ roomId: r.room_id, roomLabel: r.room_label, floorLevel: r.floor_level, latestSolvedAt: r.latest_solved_at }));
}

interface MpcScheduleApiResponse {
  room_id: string;
  room_label: string;
  solved_at: string;
  model_version: number;
  capacity_kw: number | null;
  cop_cooling: number | null;
  tariff_currency_per_kwh: number;
  carbon_weight_lambda: number;
  slots: {
    slot_ts: string;
    setpoint_c: number;
    predicted_temp_c: number;
    predicted_kwh: number;
    predicted_gco2: number;
    actual_temp_c: number | null;
  }[];
}

export async function fetchMpcSchedule(buildingId: string, roomId: string, signal?: AbortSignal): Promise<MpcSchedule | null> {
  const realBuildingId = BUILDING_ID_MAP[buildingId] ?? buildingId;
  const res = await _get(`/buildings/${encodeURIComponent(realBuildingId)}/rooms/${encodeURIComponent(roomId)}/mpc-schedule`, signal);
  if (res.status === 404) return null;
  if (!res.ok) throw new ThermalApiError(`Thermal Agent API returned ${res.status}`);
  const d: MpcScheduleApiResponse = await res.json();
  return {
    roomId: d.room_id,
    roomLabel: d.room_label,
    solvedAt: d.solved_at,
    modelVersion: d.model_version,
    capacityKw: d.capacity_kw,
    copCooling: d.cop_cooling,
    tariffCurrencyPerKwh: d.tariff_currency_per_kwh,
    carbonWeightLambda: d.carbon_weight_lambda,
    slots: d.slots.map((s) => ({
      slotTs: s.slot_ts,
      setpointC: s.setpoint_c,
      predictedTempC: s.predicted_temp_c,
      predictedKwh: s.predicted_kwh,
      predictedGco2: s.predicted_gco2,
      actualTempC: s.actual_temp_c,
    })),
  };
}

interface AnomalyOverviewApiResponse {
  anomaly_id: number;
  room_id: string;
  room_label: string;
  floor_level: number;
  anomaly_type: string;
  opened_at: string;
  closed_at: string | null;
  residual_c: number | null;
  threshold_c: number | null;
  status: LiveAnomalyOverview["status"];
  severity: LiveAnomalyOverview["severity"];
  diagnosed: boolean;
  cause: string | null;
  cause_confidence: string | null;
  supervisor_decision: string | null;
}

export async function fetchAnomalies(buildingId: string, signal?: AbortSignal): Promise<LiveAnomalyOverview[]> {
  const realBuildingId = BUILDING_ID_MAP[buildingId] ?? buildingId;
  const res = await _get(`/buildings/${encodeURIComponent(realBuildingId)}/anomalies`, signal);
  if (res.status === 404) return [];
  if (!res.ok) throw new ThermalApiError(`Thermal Agent API returned ${res.status}`);
  const data: AnomalyOverviewApiResponse[] = await res.json();
  return data.map((a) => ({
    anomalyId: a.anomaly_id,
    roomId: a.room_id,
    roomLabel: a.room_label,
    floorLevel: a.floor_level,
    anomalyType: a.anomaly_type,
    openedAt: a.opened_at,
    closedAt: a.closed_at,
    residualC: a.residual_c,
    thresholdC: a.threshold_c,
    status: a.status,
    severity: a.severity,
    diagnosed: a.diagnosed,
    cause: a.cause,
    causeConfidence: a.cause_confidence,
    supervisorDecision: a.supervisor_decision,
  }));
}

interface AnomalyDetailApiResponse {
  anomaly_id: number;
  room_id: string;
  room_label: string;
  floor_level: number;
  anomaly_type: string;
  opened_at: string;
  closed_at: string | null;
  residual_c: number | null;
  threshold_c: number | null;
  residual_trace: { ts: string; residual_c: number }[];
  status: LiveAnomalyDetail["status"];
  severity: LiveAnomalyDetail["severity"];
  diagnosed: boolean;
  diagnosis: {
    id: number;
    cause: string;
    cause_confidence: string;
    evidence: string[];
    energy_wasted_kwh: number;
    energy_wasted_basis: string;
    proposed_action: Record<string, unknown>;
    recurrence: Record<string, unknown>;
    message: string;
    supervisor_decision: string;
    created_at: string;
  } | null;
}

export async function fetchAnomalyDetail(buildingId: string, anomalyId: number, signal?: AbortSignal): Promise<LiveAnomalyDetail | null> {
  const realBuildingId = BUILDING_ID_MAP[buildingId] ?? buildingId;
  const res = await _get(`/buildings/${encodeURIComponent(realBuildingId)}/anomalies/${anomalyId}`, signal);
  if (res.status === 404) return null;
  if (!res.ok) throw new ThermalApiError(`Thermal Agent API returned ${res.status}`);
  const d: AnomalyDetailApiResponse = await res.json();
  return {
    anomalyId: d.anomaly_id,
    roomId: d.room_id,
    roomLabel: d.room_label,
    floorLevel: d.floor_level,
    anomalyType: d.anomaly_type,
    openedAt: d.opened_at,
    closedAt: d.closed_at,
    residualC: d.residual_c,
    thresholdC: d.threshold_c,
    residualTrace: d.residual_trace,
    status: d.status,
    severity: d.severity,
    diagnosed: d.diagnosed,
    diagnosis: d.diagnosis
      ? {
          id: d.diagnosis.id,
          cause: d.diagnosis.cause,
          causeConfidence: d.diagnosis.cause_confidence,
          evidence: d.diagnosis.evidence,
          energyWastedKwh: d.diagnosis.energy_wasted_kwh,
          energyWastedBasis: d.diagnosis.energy_wasted_basis,
          proposedAction: d.diagnosis.proposed_action,
          recurrence: d.diagnosis.recurrence,
          message: d.diagnosis.message,
          supervisorDecision: d.diagnosis.supervisor_decision,
          createdAt: d.diagnosis.created_at,
        }
      : null,
  };
}

interface DiagnosisOverviewApiResponse {
  id: number;
  anomaly_id: number;
  room_id: string;
  room_label: string;
  floor_level: number;
  cause: string;
  cause_confidence: string;
  energy_wasted_kwh: number;
  energy_wasted_basis: string;
  proposed_action_type: string;
  supervisor_decision: string;
  message: string;
  created_at: string;
}

export async function fetchDiagnoses(buildingId: string, signal?: AbortSignal): Promise<LiveDiagnosisOverview[]> {
  const realBuildingId = BUILDING_ID_MAP[buildingId] ?? buildingId;
  const res = await _get(`/buildings/${encodeURIComponent(realBuildingId)}/diagnoses`, signal);
  if (res.status === 404) return [];
  if (!res.ok) throw new ThermalApiError(`Thermal Agent API returned ${res.status}`);
  const data: DiagnosisOverviewApiResponse[] = await res.json();
  return data.map((d) => ({
    id: d.id,
    anomalyId: d.anomaly_id,
    roomId: d.room_id,
    roomLabel: d.room_label,
    floorLevel: d.floor_level,
    cause: d.cause,
    causeConfidence: d.cause_confidence,
    energyWastedKwh: d.energy_wasted_kwh,
    energyWastedBasis: d.energy_wasted_basis,
    proposedActionType: d.proposed_action_type,
    supervisorDecision: d.supervisor_decision,
    message: d.message,
    createdAt: d.created_at,
  }));
}

interface AlertApiResponse {
  id: number;
  diagnosis_id: number;
  anomaly_id: number;
  room_id: string;
  room_label: string;
  floor_level: number;
  channel: string;
  recipient: string;
  cause: string;
  cause_confidence: string;
  message: string;
  sent_at: string;
}

export async function fetchAlerts(buildingId: string, signal?: AbortSignal): Promise<LiveAlert[]> {
  const realBuildingId = BUILDING_ID_MAP[buildingId] ?? buildingId;
  const res = await _get(`/buildings/${encodeURIComponent(realBuildingId)}/alerts`, signal);
  if (res.status === 404) return [];
  if (!res.ok) throw new ThermalApiError(`Thermal Agent API returned ${res.status}`);
  const data: AlertApiResponse[] = await res.json();
  return data.map((a) => ({
    id: a.id,
    diagnosisId: a.diagnosis_id,
    anomalyId: a.anomaly_id,
    roomId: a.room_id,
    roomLabel: a.room_label,
    floorLevel: a.floor_level,
    channel: a.channel,
    recipient: a.recipient,
    cause: a.cause,
    causeConfidence: a.cause_confidence,
    message: a.message,
    sentAt: a.sent_at,
  }));
}

interface ReportsSummaryApiResponse {
  window_days: number;
  total_predicted_kwh: number;
  total_predicted_gco2: number;
  total_predicted_cost_currency: number;
  tariff_currency_per_kwh: number;
  avg_comfort_deviation_c: number | null;
  daily: { date: string; kwh: number; gco2: number }[];
  comfort_leaderboard: {
    room_id: string;
    room_label: string;
    floor_level: number;
    latest_temp_c: number;
    deviation_c: number;
    reading_at: string;
  }[];
}

export async function fetchReportsSummary(buildingId: string, days = 30, signal?: AbortSignal): Promise<ReportsSummary | null> {
  const realBuildingId = BUILDING_ID_MAP[buildingId] ?? buildingId;
  const res = await _get(`/buildings/${encodeURIComponent(realBuildingId)}/reports/summary?days=${days}`, signal);
  if (res.status === 404) return null;
  if (!res.ok) throw new ThermalApiError(`Thermal Agent API returned ${res.status}`);
  const d: ReportsSummaryApiResponse = await res.json();
  return {
    windowDays: d.window_days,
    totalPredictedKwh: d.total_predicted_kwh,
    totalPredictedGco2: d.total_predicted_gco2,
    totalPredictedCostCurrency: d.total_predicted_cost_currency,
    tariffCurrencyPerKwh: d.tariff_currency_per_kwh,
    avgComfortDeviationC: d.avg_comfort_deviation_c,
    daily: d.daily,
    comfortLeaderboard: d.comfort_leaderboard.map((r) => ({
      roomId: r.room_id,
      roomLabel: r.room_label,
      floorLevel: r.floor_level,
      latestTempC: r.latest_temp_c,
      deviationC: r.deviation_c,
      readingAt: r.reading_at,
    })),
  };
}
