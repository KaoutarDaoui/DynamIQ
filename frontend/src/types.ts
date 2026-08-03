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
  todayEnergyKwh: number;
  todayCarbonKg: number;
  weather: {
    tempC: number;
    condition: string;
    windKph: number;
    humidityPct: number;
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