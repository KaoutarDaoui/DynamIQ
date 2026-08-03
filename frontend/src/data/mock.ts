import type {
  AgentStatus,
  Alert,
  Anomaly,
  AuditEntry,
  Building,
  Diagnosis,
  EnergyPoint,
  Floor,
  MpcSchedulePoint,
  Room,
  UserProfile,
} from "../types";

export const currentUser: UserProfile = {
  id: "u-1",
  name: "Amira Rezzoug",
  email: "mr_amira@esi.dz",
  role: "admin",
  avatarInitials: "AR",
};

export const buildings: Building[] = [
  {
    id: "esi-algiers",
    name: "ESI Algiers",
    address: "Oued Smar, Algiers",
    floorsCount: 4,
    roomsCount: 42,
    healthScore: 87,
    activeAnomalies: 2,
    energySavedPct: 27,
    co2AvoidedTonMonth: 1.4,
    status: "monitoring",
    sensorsOnline: 42,
    sensorsTotal: 42,
    lastAiOptimization: "12 minutes ago",
    todayEnergyKwh: 126,
    todayCarbonKg: 31,
    weather: { tempC: 36, condition: "Sunny", windKph: 12, humidityPct: 41, solar: "High" },
    agents: [
      { name: "Agent 1", label: "Building analysis", state: "completed", detail: "Completed" },
      { name: "Agent 2", label: "Thermal prediction", state: "monitoring", detail: "Monitoring" },
      { name: "Agent 3", label: "Diagnosis", state: "idle", detail: "No active diagnosis" },
      { name: "Agent 4", label: "Supervision", state: "completed", detail: "Healthy" },
    ],
  },
  {
    id: "djezzy-hq",
    name: "Djezzy HQ Annex",
    address: "Hydra, Algiers",
    floorsCount: 6,
    roomsCount: 68,
    healthScore: 92,
    activeAnomalies: 0,
    energySavedPct: 19,
    co2AvoidedTonMonth: 2.1,
    status: "healthy",
    sensorsOnline: 66,
    sensorsTotal: 68,
    lastAiOptimization: "1 hour ago",
    todayEnergyKwh: 208,
    todayCarbonKg: 49,
    weather: { tempC: 37, condition: "Sunny", windKph: 9, humidityPct: 38, solar: "High" },
    agents: [
      { name: "Agent 1", label: "Building analysis", state: "completed", detail: "Completed" },
      { name: "Agent 2", label: "Thermal prediction", state: "monitoring", detail: "Monitoring" },
      { name: "Agent 3", label: "Diagnosis", state: "idle", detail: "No active diagnosis" },
      { name: "Agent 4", label: "Supervision", state: "completed", detail: "Healthy" },
    ],
  },
];

export const floors: Floor[] = [
  { id: "floor-1", buildingId: "esi-algiers", level: 1, label: "Floor 1", planImageAlt: "Floor 1 plan", roomIds: ["room-101", "room-102", "room-103", "room-104"] },
  { id: "floor-2", buildingId: "esi-algiers", level: 2, label: "Floor 2", planImageAlt: "Floor 2 plan", roomIds: ["room-201", "room-202", "room-203"] },
  { id: "floor-3", buildingId: "esi-algiers", level: 3, label: "Floor 3", planImageAlt: "Floor 3 plan", roomIds: ["room-204", "room-21"] },
];

export const rooms: Room[] = [
  {
    id: "room-101",
    label: "Salle 101",
    floorId: "floor-1",
    areaM2: 45,
    orientation: "north",
    currentTempC: 24.1,
    predictedTempC: 24.0,
    targetTempC: 22,
    status: "normal",
    envelope: {
      externalWalls: ["north", "east"],
      internalWalls: ["south", "west"],
      wallAreaM2: { north: 15.5, south: 0, east: 10.2, west: 0 },
    },
    thermal: { wallRValue: 1.8, windowUValue: 5.8, estimatedCZone: 145000, thermalMass: "heavy" },
    hvac: { type: "split_unit", unitId: "AC-101-A", capacityKw: 3.5, copCooling: 2.8, setpointOccupiedC: 22, status: "online" },
  },
  {
    id: "room-102",
    label: "Salle 102",
    floorId: "floor-1",
    areaM2: 38,
    orientation: "south",
    currentTempC: 23.4,
    predictedTempC: 23.5,
    targetTempC: 22,
    status: "normal",
    envelope: { externalWalls: ["south"], internalWalls: ["north", "east", "west"], wallAreaM2: { north: 0, south: 12.1, east: 0, west: 0 } },
    thermal: { wallRValue: 2.1, windowUValue: 4.9, estimatedCZone: 121000, thermalMass: "medium" },
    hvac: { type: "split_unit", unitId: "AC-102-A", capacityKw: 2.8, copCooling: 3.1, setpointOccupiedC: 22, status: "online" },
  },
  {
    id: "room-103",
    label: "Salle 103 (Amphi)",
    floorId: "floor-1",
    areaM2: 96,
    orientation: "east",
    currentTempC: 27.8,
    predictedTempC: 24.2,
    targetTempC: 23,
    status: "anomaly",
    envelope: { externalWalls: ["east", "north"], internalWalls: ["south"], wallAreaM2: { north: 9.0, south: 0, east: 22.4, west: 0 } },
    thermal: { wallRValue: 1.4, windowUValue: 6.2, estimatedCZone: 268000, thermalMass: "heavy" },
    hvac: { type: "vrf", unitId: "AC-103-A", capacityKw: 7.2, copCooling: 2.6, setpointOccupiedC: 23, status: "online" },
  },
  {
    id: "room-104",
    label: "Salle 104",
    floorId: "floor-1",
    areaM2: 41,
    orientation: "west",
    currentTempC: 22.9,
    predictedTempC: 22.7,
    targetTempC: 22,
    status: "watch",
    envelope: { externalWalls: ["west"], internalWalls: ["north", "south", "east"], wallAreaM2: { north: 0, south: 0, east: 0, west: 11.0 } },
    thermal: { wallRValue: 1.9, windowUValue: 5.1, estimatedCZone: 132000, thermalMass: "medium" },
    hvac: { type: "split_unit", unitId: "AC-104-A", capacityKw: 3.0, copCooling: 2.9, setpointOccupiedC: 22, status: "online" },
  },
  {
    id: "room-201",
    label: "Salle 201",
    floorId: "floor-2",
    areaM2: 40,
    orientation: "north",
    currentTempC: 23.0,
    predictedTempC: 23.1,
    targetTempC: 22,
    status: "normal",
    envelope: { externalWalls: ["north"], internalWalls: ["south", "east", "west"], wallAreaM2: { north: 13.0, south: 0, east: 0, west: 0 } },
    thermal: { wallRValue: 1.8, windowUValue: 5.5, estimatedCZone: 128000, thermalMass: "medium" },
    hvac: { type: "split_unit", unitId: "AC-201-A", capacityKw: 2.8, copCooling: 3.0, setpointOccupiedC: 22, status: "online" },
  },
  {
    id: "room-202",
    label: "Salle 202",
    floorId: "floor-2",
    areaM2: 40,
    orientation: "south",
    currentTempC: 23.6,
    predictedTempC: 23.4,
    targetTempC: 22,
    status: "normal",
    envelope: { externalWalls: ["south"], internalWalls: ["north", "east", "west"], wallAreaM2: { north: 0, south: 13.0, east: 0, west: 0 } },
    thermal: { wallRValue: 1.8, windowUValue: 5.5, estimatedCZone: 128000, thermalMass: "medium" },
    hvac: { type: "split_unit", unitId: "AC-202-A", capacityKw: 2.8, copCooling: 3.0, setpointOccupiedC: 22, status: "offline" },
  },
  {
    id: "room-203",
    label: "Salle 203",
    floorId: "floor-2",
    areaM2: 35,
    orientation: "east",
    currentTempC: 22.4,
    predictedTempC: 22.5,
    targetTempC: 22,
    status: "normal",
    envelope: { externalWalls: ["east"], internalWalls: ["north", "south", "west"], wallAreaM2: { north: 0, south: 0, east: 10.5, west: 0 } },
    thermal: { wallRValue: 2.0, windowUValue: 4.8, estimatedCZone: 112000, thermalMass: "light" },
    hvac: { type: "split_unit", unitId: "AC-203-A", capacityKw: 2.5, copCooling: 3.2, setpointOccupiedC: 22, status: "online" },
  },
  {
    id: "room-204",
    label: "Salle 204 (Lab)",
    floorId: "floor-3",
    areaM2: 52,
    orientation: "north",
    currentTempC: 24.6,
    predictedTempC: 23.9,
    targetTempC: 23,
    status: "watch",
    envelope: { externalWalls: ["north", "west"], internalWalls: ["south", "east"], wallAreaM2: { north: 14.0, south: 0, east: 0, west: 8.5 } },
    thermal: { wallRValue: 1.6, windowUValue: 5.9, estimatedCZone: 156000, thermalMass: "heavy" },
    hvac: { type: "split_unit", unitId: "AC-204-A", capacityKw: 3.5, copCooling: 2.7, setpointOccupiedC: 23, status: "online" },
  },
  {
    id: "room-21",
    label: "Salle 21",
    floorId: "floor-3",
    areaM2: 30,
    orientation: "south",
    currentTempC: 23.1,
    predictedTempC: 23.0,
    targetTempC: 22,
    status: "normal",
    envelope: { externalWalls: ["south"], internalWalls: ["north", "east", "west"], wallAreaM2: { north: 0, south: 9.6, east: 0, west: 0 } },
    thermal: { wallRValue: 1.9, windowUValue: 5.2, estimatedCZone: 98000, thermalMass: "medium" },
    hvac: { type: "split_unit", unitId: "AC-021-A", capacityKw: 2.2, copCooling: 3.1, setpointOccupiedC: 22, status: "online" },
  },
];

export const anomalies: Anomaly[] = [
  {
    id: "an-1",
    roomId: "room-103",
    floorId: "floor-1",
    raisedAt: "2026-08-03T13:42:00Z",
    predictedC: 24.2,
    measuredC: 27.8,
    deltaC: 3.6,
    severity: "high",
    status: "diagnosed",
  },
  {
    id: "an-2",
    roomId: "room-204",
    floorId: "floor-3",
    raisedAt: "2026-08-03T11:05:00Z",
    predictedC: 23.9,
    measuredC: 24.6,
    deltaC: 0.7,
    severity: "low",
    status: "diagnosing",
  },
  {
    id: "an-3",
    roomId: "room-202",
    floorId: "floor-2",
    raisedAt: "2026-08-02T09:15:00Z",
    predictedC: 22.3,
    measuredC: 22.1,
    deltaC: -0.2,
    severity: "low",
    status: "resolved",
  },
  {
    id: "an-4",
    roomId: "room-301",
    floorId: "floor-3",
    raisedAt: "2026-08-02T16:20:00Z",
    predictedC: 23.4,
    measuredC: 25.1,
    deltaC: 1.7,
    severity: "medium",
    status: "open",
  },
  {
    id: "an-5",
    roomId: "room-102",
    floorId: "floor-1",
    raisedAt: "2026-08-01T08:40:00Z",
    predictedC: 23.0,
    measuredC: 24.9,
    deltaC: 1.9,
    severity: "medium",
    status: "diagnosed",
  },
  {
    id: "an-6",
    roomId: "room-402",
    floorId: "floor-4",
    raisedAt: "2026-08-01T14:10:00Z",
    predictedC: 23.8,
    measuredC: 27.6,
    deltaC: 3.8,
    severity: "high",
    status: "open",
  },
  {
    id: "an-7",
    roomId: "room-203",
    floorId: "floor-2",
    raisedAt: "2026-07-31T10:00:00Z",
    predictedC: 22.6,
    measuredC: 22.8,
    deltaC: 0.2,
    severity: "low",
    status: "resolved",
  },
];

export const diagnoses: Diagnosis[] = [
  {
    id: "di-1",
    anomalyId: "an-1",
    cause: "Window left open in the amphitheatre after the last session, letting outside heat in faster than the model expected.",
    confidencePct: 84,
    proposedAction: "Notify the on-duty technician to close the window and confirm AC-103-A is running at full capacity.",
    evidence: [
      { tool: "get_weather_forecast", finding: "Outside temperature 38C at time of anomaly, above forecast." },
      { tool: "get_room_schedule", finding: "Room was occupied until 13:00, no session scheduled after." },
      { tool: "get_sensor_history", finding: "Temperature rise rate is 3x faster than the calibrated RC model predicts for a closed room." },
      { tool: "get_similar_anomalies", finding: "2 similar rises in this room over the last 30 days, both resolved by closing a window." },
    ],
    decision: "human_alert",
    createdAt: "2026-08-03T13:47:00Z",
  },
];

export const alerts: Alert[] = [
  {
    id: "al-1",
    diagnosisId: "di-1",
    roomId: "room-103",
    channel: "in_app",
    message: "Salle 103: probable open window, temperature 3.6C above prediction. Please check.",
    createdAt: "2026-08-03T13:47:30Z",
    acknowledged: false,
    assignedRole: "technician",
  },
  {
    id: "al-2",
    diagnosisId: "di-1",
    roomId: "room-103",
    channel: "webhook",
    message: "Dispatched to facilities webhook for Salle 103 window check.",
    createdAt: "2026-08-03T13:47:31Z",
    acknowledged: true,
    assignedRole: "facility_manager",
  },
];

export const auditLog: AuditEntry[] = [
  { id: "au-1", timestamp: "2026-08-03T13:47:31Z", actor: "Agent 4 Supervisor", action: "human_alert routed", detail: "Diagnosis di-1 routed to technician + facility manager for room-103." },
  { id: "au-2", timestamp: "2026-08-03T13:47:00Z", actor: "Agent 3 Diagnostic", action: "diagnosis created", detail: "Cause: open window, confidence 84%." },
  { id: "au-3", timestamp: "2026-08-03T13:42:00Z", actor: "Agent 2 Thermal", action: "thermal_anomaly raised", detail: "room-103 predicted 24.2C, measured 27.8C." },
  { id: "au-4", timestamp: "2026-08-03T06:00:00Z", actor: "Agent 2 Thermal", action: "calibration sweep", detail: "RC parameters recalibrated for 9 rooms against last 14 days of sensor data." },
  { id: "au-5", timestamp: "2026-08-02T09:20:00Z", actor: "Amira Rezzoug", action: "anomaly resolved", detail: "an-3 marked resolved after AC-202-A maintenance." },
];

export const mpcSchedule: MpcSchedulePoint[] = [
  { hour: "06:00", plannedC: 22, actualC: 22.1, carbonIntensity: 210, priceDzdKwh: 4.1 },
  { hour: "08:00", plannedC: 22, actualC: 22.0, carbonIntensity: 180, priceDzdKwh: 4.1 },
  { hour: "10:00", plannedC: 21.5, actualC: 21.8, carbonIntensity: 140, priceDzdKwh: 4.5 },
  { hour: "12:00", plannedC: 21, actualC: 21.4, carbonIntensity: 95, priceDzdKwh: 4.5 },
  { hour: "14:00", plannedC: 22, actualC: 22.6, carbonIntensity: 110, priceDzdKwh: 5.2 },
  { hour: "16:00", plannedC: 23, actualC: 23.2, carbonIntensity: 160, priceDzdKwh: 5.2 },
  { hour: "18:00", plannedC: 24, actualC: 24.1, carbonIntensity: 240, priceDzdKwh: 6.0 },
  { hour: "20:00", plannedC: 25, actualC: 24.9, carbonIntensity: 310, priceDzdKwh: 6.0 },
  { hour: "22:00", plannedC: 26, actualC: 25.8, carbonIntensity: 260, priceDzdKwh: 4.8 },
];

export const energyLast24h: EnergyPoint[] = [
  { hour: "00", kwh: 12 }, { hour: "02", kwh: 9 }, { hour: "04", kwh: 8 }, { hour: "06", kwh: 14 },
  { hour: "08", kwh: 28 }, { hour: "10", kwh: 34 }, { hour: "12", kwh: 41 }, { hour: "14", kwh: 46 },
  { hour: "16", kwh: 39 }, { hour: "18", kwh: 30 }, { hour: "20", kwh: 22 }, { hour: "22", kwh: 15 },
];

export type ChartRange = "24h" | "7d" | "30d" | "custom";
export type ChartMetric = "energy" | "carbon" | "temperature";
export interface ChartSeriesPoint {
  label: string;
  value: number;
}

const monthEnergy: ChartSeriesPoint[] = Array.from({ length: 30 }, (_, i) => ({
  label: String(i + 1),
  value: Math.round(350 + 30 * Math.sin((i / 30) * Math.PI * 2) + 12 * Math.sin(i * 1.7)),
}));
const monthCarbon = monthEnergy.map((p) => ({ label: p.label, value: Math.round(p.value * 0.24) }));
const monthTemp: ChartSeriesPoint[] = Array.from({ length: 30 }, (_, i) => ({
  label: String(i + 1),
  value: Math.round(28 + 8 * Math.sin((i / 30) * Math.PI * 2) + 2 * Math.sin(i * 0.9)),
}));

export const dashboardSeries: Record<Exclude<ChartRange, "custom">, Record<ChartMetric, ChartSeriesPoint[]>> = {
  "24h": {
    energy: energyLast24h.map((p) => ({ label: p.hour, value: p.kwh })),
    carbon: energyLast24h.map((p) => ({ label: p.hour, value: Math.round(p.kwh * 0.24) })),
    temperature: [
      { label: "00", value: 24 }, { label: "02", value: 23 }, { label: "04", value: 22 },
      { label: "06", value: 24 }, { label: "08", value: 28 }, { label: "10", value: 31 },
      { label: "12", value: 34 }, { label: "14", value: 36 }, { label: "16", value: 35 },
      { label: "18", value: 31 }, { label: "20", value: 28 }, { label: "22", value: 26 },
    ],
  },
  "7d": {
    energy: [
      { label: "Mon", value: 382 }, { label: "Tue", value: 395 }, { label: "Wed", value: 371 },
      { label: "Thu", value: 402 }, { label: "Fri", value: 388 }, { label: "Sat", value: 342 },
      { label: "Sun", value: 318 },
    ],
    carbon: [92, 95, 89, 96, 93, 82, 76].map((v, i) => ({ label: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i], value: v })),
    temperature: [
      { label: "Mon", value: 31 }, { label: "Tue", value: 33 }, { label: "Wed", value: 32 },
      { label: "Thu", value: 35 }, { label: "Fri", value: 36 }, { label: "Sat", value: 33 },
      { label: "Sun", value: 30 },
    ],
  },
  "30d": {
    energy: monthEnergy,
    carbon: monthCarbon,
    temperature: monthTemp,
  },
};

export interface Notification {
  id: string;
  title: string;
  time: string;
  kind: "anomaly" | "calibration" | "diagnosis" | "alert";
  buildingId?: string;
  roomId?: string;
}

export const notifications: Notification[] = [
  { id: "n-1", title: "Room 204 overheating", time: "2 min ago", kind: "anomaly", buildingId: "esi-algiers", roomId: "room-204" },
  { id: "n-2", title: "Calibration finished", time: "15 min ago", kind: "calibration", buildingId: "esi-algiers" },
  { id: "n-3", title: "New diagnosis available", time: "1 hr ago", kind: "diagnosis", buildingId: "esi-algiers", roomId: "room-103" },
];

export const globalAgents: AgentStatus[] = [
  { name: "Agent 1", label: "Building analysis", state: "completed", detail: "Healthy" },
  { name: "Agent 2", label: "Thermal prediction", state: "monitoring", detail: "Running" },
  { name: "Agent 3", label: "Diagnosis", state: "idle", detail: "Idle" },
  { name: "Agent 4", label: "Supervision", state: "completed", detail: "Healthy" },
];

export const roomById = (id: string) => rooms.find((r) => r.id === id);
export const floorById = (id: string) => floors.find((f) => f.id === id);
export const buildingById = (id: string) => buildings.find((b) => b.id === id);
export const anomalyById = (id: string) => anomalies.find((a) => a.id === id);
export const diagnosisByAnomalyId = (id: string) => diagnoses.find((d) => d.anomalyId === id);
export const roomsByFloor = (floorId: string) => rooms.filter((r) => r.floorId === floorId);
export const roomsByBuilding = (buildingId: string) => {
  const floorIds = floors.filter((f) => f.buildingId === buildingId).map((f) => f.id);
  return rooms.filter((r) => floorIds.includes(r.floorId));
};