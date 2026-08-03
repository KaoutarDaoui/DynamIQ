import { useParams, Link } from "react-router-dom";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { roomById, floorById, mpcSchedule } from "../data/mock";
import { Card, CardHeader, StatusBadge, SecondaryButton } from "../components/ui";

function isDark() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

export default function RoomDetail() {
  const { buildingId = "esi-algiers", roomId = "" } = useParams();
  const room = roomById(roomId);
  const floor = room ? floorById(room.floorId) : undefined;

  if (!room) return <p className="text-[14px] text-ink-400">Room not found.</p>;

  return (
    <div className="mx-auto max-w-6xl">
      <p className="text-[12px] text-ink-400">
        <Link to={`/b/${buildingId}/floors/${room.floorId}`} className="hover:text-primary-600">{floor?.label}</Link> / {room.label}
      </p>
      <div className="mt-1 flex items-center gap-3">
        <h1 className="text-[20px] font-medium">{room.label}</h1>
        <StatusBadge status={room.status} label={room.status} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="p-5">
          <p className="text-[13px] text-ink-400">Current temperature</p>
          <p className="mt-1 text-3xl font-medium">{room.currentTempC}°C</p>
          <p className="mt-1 text-[12px] text-ink-400">Target {room.targetTempC}°C · Predicted {room.predictedTempC}°C</p>
        </Card>
        <Card className="p-5">
          <p className="text-[13px] text-ink-400">AC unit</p>
          <p className="mt-1 text-[18px] font-medium">{room.hvac.unitId}</p>
          <p className="mt-1 text-[12px] text-ink-400 capitalize">{room.hvac.type.replace("_", " ")} · {room.hvac.capacityKw} kW · COP {room.hvac.copCooling}</p>
          <div className="mt-2"><StatusBadge status={room.hvac.status} /></div>
        </Card>
        <Card className="p-5">
          <p className="text-[13px] text-ink-400">Room</p>
          <p className="mt-1 text-[18px] font-medium">{room.areaM2} m²</p>
          <p className="mt-1 text-[12px] text-ink-400 capitalize">Facing {room.orientation} · {room.thermal.thermalMass} thermal mass</p>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="24h MPC schedule" subtitle="Planned vs actual setpoint" />
        <div className="h-64 px-2 pb-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mpcSchedule} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
              <XAxis dataKey="hour" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: isDark() ? "#8c897d" : "#8c897d" }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: isDark() ? "#8c897d" : "#8c897d" }} domain={[18, 28]} />
              <Tooltip contentStyle={{ borderRadius: 12, border: isDark() ? "1px solid #3a392f" : "1px solid #e8e7e3", fontSize: 12, background: isDark() ? "#2a2925" : "#fff", color: isDark() ? "#f5f4f1" : "#23231f" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="plannedC" name="Planned °C" stroke="#ee6c1f" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="actualC" name="Actual °C" stroke="#1d9e75" strokeWidth={2} dot={false} strokeDasharray="4 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="RC model parameters" subtitle="Auto-calibrated from sensor history" />
          <dl className="divide-y divide-ink-100 px-5 pb-5 text-[14px] dark:divide-ink-800">
            <div className="flex justify-between py-2.5"><dt className="text-ink-400">Wall R-value</dt><dd className="font-medium">{room.thermal.wallRValue} m²·K/W</dd></div>
            <div className="flex justify-between py-2.5"><dt className="text-ink-400">Window U-value</dt><dd className="font-medium">{room.thermal.windowUValue} W/m²·K</dd></div>
            <div className="flex justify-between py-2.5"><dt className="text-ink-400">Estimated C (zone)</dt><dd className="font-medium">{room.thermal.estimatedCZone.toLocaleString()} J/K</dd></div>
          </dl>
        </Card>
        <Card>
          <CardHeader title="Envelope" subtitle="Walls and orientation" />
          <div className="px-5 pb-5">
            <p className="text-[13px] text-ink-400">External walls</p>
            <p className="text-[14px] font-medium capitalize">{room.envelope.externalWalls.join(", ") || "None"}</p>
            <p className="mt-3 text-[13px] text-ink-400">Internal walls</p>
            <p className="text-[14px] font-medium capitalize">{room.envelope.internalWalls.join(", ") || "None"}</p>
            <div className="mt-4">
              <SecondaryButton>Edit envelope</SecondaryButton>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}