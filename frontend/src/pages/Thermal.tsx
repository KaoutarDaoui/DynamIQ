import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { Layers, Gauge, Droplets, Timer, CheckCircle2 } from "lucide-react";
import { rooms, floors } from "../data/mock";
import { Card, CardHeader, StatusBadge } from "../components/ui";

export default function Thermal() {
  const { buildingId = "esi-algiers" } = useParams();
  const floorIds = floors.filter((f) => f.buildingId === buildingId).map((f) => f.id);
  const roomList = rooms.filter((r) => floorIds.includes(r.floorId));

  const avgR = useMemo(() => roomList.reduce((s, r) => s + r.thermal.wallRValue, 0) / Math.max(1, roomList.length), [roomList]);
  const avgU = useMemo(() => roomList.reduce((s, r) => s + r.thermal.windowUValue, 0) / Math.max(1, roomList.length), [roomList]);

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-[20px] font-medium">Thermal models</h1>
      <p className="mt-1 text-[13px] text-ink-400">RC parameters auto-calibrated from sensor history — the backbone of thermal prediction.</p>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-[12px] text-ink-400"><Layers size={13} /> Rooms modeled</p>
          <p className="mt-1 text-xl font-medium">{roomList.length}</p>
        </Card>
        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-[12px] text-ink-400"><Gauge size={13} /> Avg wall R</p>
          <p className="mt-1 text-xl font-medium">{avgR.toFixed(2)} m²·K/W</p>
        </Card>
        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-[12px] text-ink-400"><Droplets size={13} /> Avg window U</p>
          <p className="mt-1 text-xl font-medium">{avgU.toFixed(2)} W/m²·K</p>
        </Card>
        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-[12px] text-ink-400"><Timer size={13} /> Next calibration</p>
          <p className="mt-1 text-xl font-medium">in 3 h</p>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Room parameters" subtitle="Wall R-value, window U-value and estimated zone capacitance" />
        <div className="flex flex-col divide-y divide-ink-100 dark:divide-ink-800">
          {roomList.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <div className="min-w-0">
                <p className="text-[14px] font-medium">{r.label}</p>
                <p className="text-[12px] text-ink-400">
                  {floors.find((f) => f.id === r.floorId)?.label} · {r.areaM2} m² · {r.thermal.thermalMass} mass
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-[13px]">
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wide text-ink-400">Wall R</p>
                  <p className="font-medium">{r.thermal.wallRValue} m²·K/W</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wide text-ink-400">Window U</p>
                  <p className="font-medium">{r.thermal.windowUValue} W/m²·K</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wide text-ink-400">C (zone)</p>
                  <p className="font-medium">{(r.thermal.estimatedCZone / 1000).toFixed(0)}k J/K</p>
                </div>
                <span className="flex items-center gap-1 text-[12px] font-medium text-teal-700 dark:text-teal-300">
                  <CheckCircle2 size={13} /> Calibrated
                </span>
                <StatusBadge status="online" label="active" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
