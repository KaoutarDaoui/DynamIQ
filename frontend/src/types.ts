export type Role = "admin" | "facility_manager" | "technician" | "viewer";

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarInitials: string;
}

export interface Building {
  id: string;
  name: string;
  address: string;
  floorsCount: number;
  roomsCount: number;
  healthScore: number; // 0-100
  activeAnomalies: number;
  energySavedPct: number;
  co2AvoidedTonMonth: number;
  status: "healthy" | "monitoring" | "critical";
  sensorsOnline: number;
  sensorsTotal: number;
  lastAiOptimization: string;
  todayEnergyKwh: number;
  todayCarbonKg: number;
  weather: {
    tempC: number;
    condition: string;
    windKph: number;
    humidityPct: number;
    solar: "Low" | "Medium" | "High";
  };
  agents: AgentStatus[];
}

export type AgentStatusState = "completed" | "monitoring" | "idle" | "warning";

export interface AgentStatus {
  name: string; // internal id, e.g. "Agent 1"
  label: string; // human meaning, e.g. "Building analysis"
  state: AgentStatusState;
  detail: string; // "Completed", "Monitoring", "No active diagnosis", "Healthy"
}

export type WallDirection = "north" | "south" | "east" | "west";

export interface RoomEnvelope {
  externalWalls: WallDirection[];
  internalWalls: WallDirection[];
  wallAreaM2: Record<WallDirection, number>;
}

export interface RoomThermal {
  wallRValue: number; // R m2K/W
  windowUValue: number; // U W/m2K
  estimatedCZone: number; // J/K
  thermalMass: "light" | "medium" | "heavy";
}

export interface RoomHvac {
  type: string;
  unitId: string; // "AC-101-A"
  capacityKw: number;
  copCooling: number;
  setpointOccupiedC: number;
  status: "online" | "offline" | "maintenance";
}

export type RoomStatus = "normal" | "watch" | "anomaly";

export interface Room {
  id: string; // room-101
  label: string;
  floorId: string;
  areaM2: number;
  orientation: WallDirection;
  currentTempC: number;
  predictedTempC: number;
  targetTempC: number;
  status: RoomStatus;
  envelope: RoomEnvelope;
  thermal: RoomThermal;
  hvac: RoomHvac;
}

export interface Floor {
  id: string;
  buildingId: string;
  level: number;
  label: string;
  planImageAlt: string;
  roomIds: string[];
}

export type AnomalySeverity = "low" | "medium" | "high";
export type AnomalyStatusType = "open" | "diagnosing" | "diagnosed" | "resolved";

export interface Anomaly {
  id: string;
  roomId: string;
  floorId: string;
  raisedAt: string;
  predictedC: number;
  measuredC: number;
  deltaC: number;
  severity: AnomalySeverity;
  status: AnomalyStatusType;
}

export interface ToolCallEvidence {
  tool: string;
  finding: string;
}

export type SupervisorDecision = "autonomous" | "human_alert" | "log_only";

export interface Diagnosis {
  id: string;
  anomalyId: string;
  cause: string;
  confidencePct: number;
  proposedAction: string;
  evidence: ToolCallEvidence[];
  decision: SupervisorDecision;
  createdAt: string;
}

export type AlertChannelType = "log" | "webhook" | "in_app";

export interface Alert {
  id: string;
  diagnosisId: string;
  roomId: string;
  channel: AlertChannelType;
  message: string;
  createdAt: string;
  acknowledged: boolean;
  assignedRole: Role;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  detail: string;
}

export interface MpcSchedulePoint {
  hour: string;
  plannedC: number;
  actualC: number;
  carbonIntensity: number; // gCO2/kWh
  priceDzdKwh: number;
}

export interface EnergyPoint {
  hour: string;
  kwh: number;
}

export interface ThermalModelRoom {
  roomId: string;
  roomLabel: string;
  floorId: string;
  floorLevel: number;
  areaM2: number;
  isInstrumented: boolean;
  isCalibrated: boolean;
  version: number | null;
  rLumpedKPerW: number | null;
  cLumpedJPerK: number | null;
  rmseValidationC: number | null;
  anomalyThresholdC: number | null;
  dataWindowStart: string | null;
  dataWindowEnd: string | null;
  calibratedAt: string | null;
}

export interface MpcRoomSummary {
  roomId: string;
  roomLabel: string;
  floorLevel: number;
  latestSolvedAt: string;
}

export interface MpcScheduleSlot {
  slotTs: string;
  setpointC: number;
  predictedTempC: number;
  predictedKwh: number;
  predictedGco2: number;
  actualTempC: number | null;
}

export interface MpcSchedule {
  roomId: string;
  roomLabel: string;
  solvedAt: string;
  modelVersion: number;
  capacityKw: number | null;
  copCooling: number | null;
  tariffCurrencyPerKwh: number;
  carbonWeightLambda: number;
  slots: MpcScheduleSlot[];
}

export type LiveAnomalyStatus = "open" | "diagnosed" | "resolved";
export type LiveAnomalySeverity = "high" | "medium" | "low";

export interface LiveAnomalyOverview {
  anomalyId: number;
  roomId: string;
  roomLabel: string;
  floorLevel: number;
  anomalyType: string;
  openedAt: string;
  closedAt: string | null;
  residualC: number | null;
  thresholdC: number | null;
  status: LiveAnomalyStatus;
  severity: LiveAnomalySeverity;
  diagnosed: boolean;
  cause: string | null;
  causeConfidence: string | null;
  supervisorDecision: string | null;
  proposedAction: string | null;
}

export interface LiveDiagnosisSummary {
  id: number;
  cause: string;
  causeConfidence: string;
  confidenceSignals?: string[];
  evidence: string[];
  energyWastedKwh: number;
  energyWastedBasis: string;
  proposedAction: Record<string, unknown>;
  recurrence: { seen_before?: boolean; last_occurrence?: string | null; long_term_recommendation?: string | null } & Record<string, unknown>;
  message: string;
  supervisorDecision: string;
  createdAt: string;
}

export interface LiveAnomalyDetail {
  anomalyId: number;
  roomId: string;
  roomLabel: string;
  floorLevel: number;
  anomalyType: string;
  openedAt: string;
  closedAt: string | null;
  residualC: number | null;
  thresholdC: number | null;
  residualTrace: { ts: string; residual_c: number }[];
  status: LiveAnomalyStatus;
  severity: LiveAnomalySeverity;
  diagnosed: boolean;
  diagnosis: LiveDiagnosisSummary | null;
}

export interface LiveDiagnosisOverview {
  id: number;
  anomalyId: number;
  roomId: string;
  roomLabel: string;
  floorLevel: number;
  cause: string;
  causeConfidence: string;
  energyWastedKwh: number;
  energyWastedBasis: string;
  proposedActionType: string;
  supervisorDecision: string;
  message: string;
  createdAt: string;
}

export interface LiveAlert {
  id: number;
  diagnosisId: number;
  anomalyId: number;
  roomId: string;
  roomLabel: string;
  floorLevel: number;
  channel: string;
  recipient: string;
  cause: string;
  causeConfidence: string;
  message: string;
  sentAt: string;
  energyWastedKwh: number;
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

export interface DailyEnergyPoint {
  date: string;
  kwh: number;
  gco2: number;
}

export interface ComfortLeaderboardEntry {
  roomId: string;
  roomLabel: string;
  floorLevel: number;
  latestTempC: number;
  deviationC: number;
  readingAt: string;
}

export interface ReportsSummary {
  windowDays: number;
  totalPredictedKwh: number;
  totalPredictedGco2: number;
  totalPredictedCostCurrency: number;
  tariffCurrencyPerKwh: number;
  avgComfortDeviationC: number | null;
  daily: DailyEnergyPoint[];
  comfortLeaderboard: ComfortLeaderboardEntry[];
}

export interface HeatmapRoom {
  roomId: string;
  roomLabel: string;
  floorId: string;
  floorLevel: number;
  areaM2: number;
  isInstrumented: boolean;
  latestTempC: number | null;
  setpointC: number | null;
  predictedTempC: number | null;
  energyKwh24h: number;
  carbonGco2_24h: number;
  hasOpenAnomaly: boolean;
}