import type { AgentStatus, Building, Role } from "../types";
import type { LiveAlert, LiveAnomalyDetail, LiveAnomalyOverview, LiveDiagnosisOverview, MpcRoomSummary, MpcSchedule, ReportsSummary, ThermalModelRoom } from "../types";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8010";

// Fixed until the frontend has an org switcher / auth-derived org context.
export const DEFAULT_ORG_ID = "ORG_AMAZON";

const THERMAL_API_BASE = import.meta.env.VITE_THERMAL_API_URL ?? "http://localhost:8001";
const DIAGNOSTIC_API_BASE = import.meta.env.VITE_DIAGNOSTIC_API_URL ?? "http://localhost:8002";

// Identity map: every building_id (e.g. "djezzy-hq") is passed through
// unchanged to the API — the `BUILDING_ID_MAP[buildingId] ?? buildingId`
// fallback below already performs the identity. No legacy translations.
const BUILDING_ID_MAP: Record<string, string> = {};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail : response.statusText;
    throw new ApiError(detail, response.status);
  }
  return response.json() as Promise<T>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  return handleResponse<T>(response);
}

// No Content-Type here — the browser sets multipart/form-data with the
// correct boundary itself; overriding it breaks the upload.
async function requestForm<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { method: "POST", body: form });
  return handleResponse<T>(response);
}

export interface BuildingSummaryDto {
  building_id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  total_floors: number;
  country_code: string;
  floors_uploaded: number;
  rooms_count: number;
}

export interface BuildingCreatePayload {
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  total_floors: number;
  country_code?: string;
}

export interface BuildingCreatedDto {
  building_id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  total_floors: number;
  country_code: string;
  org_id: string | null;
}

export function fetchOrgBuildings(orgId: string = DEFAULT_ORG_ID): Promise<BuildingSummaryDto[]> {
  return request(`/organisations/${orgId}/buildings`);
}

export interface AuthUserDto {
  user_id: string;
  name: string;
  email: string;
  org_id: string | null;
  role: Role;
}

export interface LoginResponseDto {
  token: string;
  user: AuthUserDto;
}

export function login(email: string, password: string): Promise<LoginResponseDto> {
  return request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function fetchMe(token: string): Promise<AuthUserDto> {
  return request("/auth/me", { headers: { Authorization: `Bearer ${token}` } });
}

export async function logout(token: string): Promise<void> {
  await fetch(`${API_BASE_URL}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}

export function createBuilding(payload: BuildingCreatePayload): Promise<BuildingCreatedDto> {
  return request("/buildings", { method: "POST", body: JSON.stringify(payload) });
}

// Clockwise degrees from the image's "up" edge to true north (0-359), set
// via the compass dial. Any value is valid — the backend rounds to the
// nearest of 8 compass points per wall.
export type NorthAngleDeg = number;

export interface RoomOutDto {
  room_id: string;
  room_label: string;
  room_type: string;
  area_m2: number;
  volume_m3: number;
  primary_orientation: string;
  needs_review: boolean;
}

export interface FloorUploadResponseDto {
  building_id: string;
  floor_level: number;
  floor_id: string;
  rooms_saved: number;
  rooms_flagged: number;
  room_ids: string[];
  flagged_room_ids: string[];
  rooms: RoomOutDto[];
  oriented_walls: Record<string, string>;
  iterations_used: number;
  run_id: string;
  annotated_plan_url: string | null;
}

export function uploadFloorPlan(
  buildingId: string,
  floorLevel: number,
  file: File,
  northAngleDeg: NorthAngleDeg
): Promise<FloorUploadResponseDto> {
  const form = new FormData();
  form.append("north_angle_deg", String(northAngleDeg));
  form.append("plan_file", file);
  return requestForm(`/buildings/${buildingId}/floors/${floorLevel}/upload`, form);
}

export interface AcOutDto {
  ac_id: string;
  cooling_capacity_kw: number | null;
  power_kw: number | null;
}

// Replaces (not accumulates) all AC units for a room — safe to re-submit if
// the user edits the count/capacity after an earlier save.
export function setRoomAirConditioners(
  roomId: string,
  count: number,
  capacityKw: number
): Promise<AcOutDto[]> {
  return request(`/rooms/${roomId}/air-conditioners`, {
    method: "POST",
    body: JSON.stringify({ count, capacity_kw: capacityKw }),
  });
}

// Agent 2-4 (thermal prediction, diagnosis, supervision) don't exist yet, so
// a freshly-onboarded building has no live health/energy/sensor data. These
// placeholders keep the existing Portfolio UI (built for the mock dataset)
// working without lying about data we don't have — everything reads as
// "not yet monitored" rather than a fake healthy/critical score.
const placeholderAgents: AgentStatus[] = [
  { name: "Agent 1", label: "Building analysis", state: "completed", detail: "Completed" },
  { name: "Agent 2", label: "Thermal prediction", state: "idle", detail: "Not yet available" },
  { name: "Agent 3", label: "Diagnosis", state: "idle", detail: "Not yet available" },
  { name: "Agent 4", label: "Supervision", state: "idle", detail: "Not yet available" },
];

export function toPortfolioBuilding(dto: BuildingSummaryDto): Building {
  return {
    id: dto.building_id,
    name: dto.name,
    address: dto.address ?? "—",
    floorsCount: dto.total_floors,
    roomsCount: dto.rooms_count,
    healthScore: 0,
    activeAnomalies: 0,
    energySavedPct: 0,
    co2AvoidedTonMonth: 0,
    status: "monitoring",
    sensorsOnline: 0,
    sensorsTotal: 0,
    lastAiOptimization: "—",
    todayEnergyKwh: 0,
    todayCarbonKg: 0,
    weather: { tempC: 0, condition: "No data", windKph: 0, humidityPct: 0, solar: "Low" },
    agents: placeholderAgents,
  };
}

export class ThermalApiError extends Error {}

async function _get(path: string, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(`${THERMAL_API_BASE}${path}`, { signal });
  } catch {
    throw new ThermalApiError(`Could not reach the Thermal Agent API at ${THERMAL_API_BASE}`);
  }
}

async function _put(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(`${THERMAL_API_BASE}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    throw new ThermalApiError(`Could not reach the Thermal Agent API at ${THERMAL_API_BASE}`);
  }
}

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
  proposed_action: string | null;
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
    proposedAction: a.proposed_action,
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
    confidence_signals?: string[];
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
          confidenceSignals: d.diagnosis.confidence_signals,
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
  energy_wasted_kwh: number;
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
    energyWastedKwh: a.energy_wasted_kwh,
  }));
}

interface ToolCallApiResponse {
  tool: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  result_summary?: string;
  timestamp: string;
}

interface AuditLogApiResponse {
  id: number;
  anomaly_id: number;
  room_id: string;
  invoked_at: string;
  tool_calls: ToolCallApiResponse[];
  model_output: Record<string, unknown>;
  supervisor_decision: Record<string, unknown>;
  diagnosis_id: number | null;
  created_at: string;
  action_decision: ActionDecisionApiResponse | null;
}

export interface AuditLogToolCall {
  tool: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  resultSummary?: string;
  timestamp: string;
}

export interface AuditLog {
  id: number;
  anomalyId: number;
  roomId: string;
  invokedAt: string;
  toolCalls: AuditLogToolCall[];
  modelOutput: Record<string, unknown>;
  supervisorDecision: Record<string, unknown>;
  diagnosisId: number | null;
  createdAt: string;
  actionDecision: ActionDecision | null;
}

export async function fetchAuditLog(anomalyId: number, signal?: AbortSignal): Promise<AuditLog | null> {
  try {
    const res = await fetch(`${DIAGNOSTIC_API_BASE}/anomalies/${anomalyId}/audit`, { signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new ThermalApiError(`Diagnostic Agent API returned ${res.status}`);
    const d: AuditLogApiResponse = await res.json();
    return {
      id: d.id,
      anomalyId: d.anomaly_id,
      roomId: d.room_id,
      invokedAt: d.invoked_at,
      toolCalls: d.tool_calls.map((tc) => ({
        tool: tc.tool,
        args: tc.args,
        result: tc.result,
        resultSummary: tc.result_summary,
        timestamp: tc.timestamp,
      })),
      modelOutput: d.model_output,
      supervisorDecision: d.supervisor_decision,
      diagnosisId: d.diagnosis_id,
      createdAt: d.created_at,
      actionDecision: d.action_decision ? mapActionDecision(d.action_decision) : null,
    };
  } catch {
    return null;
  }
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

interface AlertEmailApiResponse {
  email: string | null;
}

export async function fetchAlertEmail(buildingId: string, signal?: AbortSignal): Promise<string | null> {
  const realBuildingId = BUILDING_ID_MAP[buildingId] ?? buildingId;
  const res = await _get(`/buildings/${encodeURIComponent(realBuildingId)}/settings/alert-email`, signal);
  if (res.status === 404) return null;
  if (!res.ok) throw new ThermalApiError(`Thermal Agent API returned ${res.status}`);
  const d: AlertEmailApiResponse = await res.json();
  return d.email;
}

export async function updateAlertEmail(buildingId: string, email: string): Promise<string> {
  const realBuildingId = BUILDING_ID_MAP[buildingId] ?? buildingId;
  const res = await _put(`/buildings/${encodeURIComponent(realBuildingId)}/settings/alert-email`, { email });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail : `Thermal Agent API returned ${res.status}`;
    throw new ThermalApiError(detail);
  }
  const d: AlertEmailApiResponse = await res.json();
  return d.email ?? email;
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

interface ActionDecisionApiResponse {
  id: number;
  anomaly_id: number;
  diagnosis_id: number | null;
  room_id: string;
  decision: string;
  action_type: string | null;
  delta_c: number | null;
  decided_by: string | null;
  decided_at: string;
}

export interface ActionDecision {
  id: number;
  anomalyId: number;
  diagnosisId: number | null;
  roomId: string;
  decision: string;
  actionType: string | null;
  deltaC: number | null;
  decidedBy: string | null;
  decidedAt: string;
}

function mapActionDecision(d: ActionDecisionApiResponse): ActionDecision {
  return {
    id: d.id,
    anomalyId: d.anomaly_id,
    diagnosisId: d.diagnosis_id,
    roomId: d.room_id,
    decision: d.decision,
    actionType: d.action_type,
    deltaC: d.delta_c,
    decidedBy: d.decided_by,
    decidedAt: d.decided_at,
  };
}

export async function fetchActionDecision(anomalyId: number, signal?: AbortSignal): Promise<ActionDecision | null> {
  try {
    const res = await fetch(`${DIAGNOSTIC_API_BASE}/anomalies/${anomalyId}/action-decision`, { signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new ThermalApiError(`Diagnostic Agent API returned ${res.status}`);
    const d: ActionDecisionApiResponse = await res.json();
    return mapActionDecision(d);
  } catch {
    return null;
  }
}

export async function recordActionDecision(anomalyId: number, decision: "applied" | "rejected", decidedBy?: string): Promise<ActionDecision> {
  const res = await fetch(`${DIAGNOSTIC_API_BASE}/anomalies/${anomalyId}/action-decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, decided_by: decidedBy ?? "facility_manager" }),
  });
  if (!res.ok) throw new ThermalApiError(`Diagnostic Agent API returned ${res.status}`);
  const d: ActionDecisionApiResponse = await res.json();
  return mapActionDecision(d);
}
