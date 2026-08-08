import type { AgentStatus, Building } from "../types";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

// Fixed until the frontend has an org switcher / auth-derived org context.
export const DEFAULT_ORG_ID = "ORG_AMAZON";

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
}

export interface FloorUploadResponseDto {
  building_id: string;
  floor_level: number;
  rooms_saved: number;
  room_ids: string[];
  rooms: RoomOutDto[];
  oriented_walls: Record<string, string>;
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
    todayEnergyKwh: 0,
    todayCarbonKg: 0,
    weather: { tempC: 0, condition: "No data", windKph: 0, humidityPct: 0 },
    agents: placeholderAgents,
  };
}
