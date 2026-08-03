import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import clsx from "clsx";
import { AlertTriangle, Eye } from "lucide-react";
import { floors, roomsByFloor } from "../data/mock";
import type { Room } from "../types";
import { Card, CardHeader, StatusBadge } from "../components/ui";

type ViewMode = "temperature" | "energy" | "carbon";

const MODES: { id: ViewMode; label: string }[] = [
  { id: "temperature", label: "Temperature" },
  { id: "energy", label: "Energy" },
  { id: "carbon", label: "Carbon" },
];

function tempColor(current: number, target: number) {
  const delta = current - target;
  if (delta > 2) return { cell: "bg-red-500/15 border-red-500/40", text: "text-red-700 dark:text-red-300" };
  if (delta > 0.8) return { cell: "bg-amber-500/15 border-amber-500/40", text: "text-amber-700 dark:text-amber-300" };
  return { cell: "bg-teal-500/12 border-teal-500/35", text: "text-teal-700 dark:text-teal-300" };
}

function roomEnergyKwh(r: Room): number {
  const load = r.status === "anomaly" ? 0.9 : r.status === "watch" ? 0.72 : 0.5;
  const seed = (parseInt(r.id.replace(/\D/g, ""), 10) % 7) - 3;
  const kwh = r.hvac.capacityKw * 8 * load * (1 + seed * 0.05);
  return Math.round(kwh * 10) / 10;
}

function levelColor(v: number, max: number) {
  if (max <= 0) return { cell: "bg-teal-500/12 border-teal-500/35", text: "text-teal-700 dark:text-teal-300" };
  const ratio = v / max;
  if (ratio > 0.8) return { cell: "bg-red-500/15 border-red-500/40", text: "text-red-700 dark:text-red-300" };
  if (ratio > 0.5) return { cell: "bg-amber-500/15 border-amber-500/40", text: "text-amber-700 dark:text-amber-300" };
  return { cell: "bg-teal-500/12 border-teal-500/35", text: "text-teal-700 dark:text-teal-300" };
}

function Legend({ mode }: { mode: ViewMode }) {
  if (mode === "temperature") {
    return (
      <div className="flex flex-wrap items-center gap-3 text-[12px] text-ink-500 dark:text-ink-300">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-teal-500/60" /> On target (Δ ≤ 0.8°C)</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500/60" /> Drift (Δ 0.8–2°C)</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500/60" /> Anomaly (Δ &gt; 2°C)</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-[12px] text-ink-500 dark:text-ink-300">
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-teal-500/60" /> Low</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500/60" /> Medium</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500/60" /> High</span>
    </div>
  );
}

export default function FloorView() {
  const { buildingId = "esi-algiers", floorId = "floor-1" } = useParams();
  const [mode, setMode] = useState<ViewMode>("temperature");
  const floor = floors.find((f) => f.id === floorId);
  const floorList = floors.filter((f) => f.buildingId === buildingId);
  const roomList = roomsByFloor(floorId);

  const maxEnergy = useMemo(() => Math.max(0.1, ...roomList.map(roomEnergyKwh)), [roomList]);
  const maxCarbon = useMemo(() => Math.max(0.1, ...roomList.map((r) => roomEnergyKwh(r) * 0.24)), [roomList]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {floorList.map((f) => (
          <Link
            key={f.id}
            to={`/b/${buildingId}/floors/${f.id}`}
            className={clsx(
              "rounded-full px-3.5 py-1.5 text-[13px] font-medium",
              f.id === floorId ? "bg-primary-500 text-white" : "bg-white border border-ink-100 text-ink-600 hover:border-primary-300 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-300 dark:hover:border-primary-600"
            )}
          >
            {f.label}
          </Link>
        ))}
        <div className="ml-auto flex gap-1 rounded-xl bg-ink-100 p-1 dark:bg-ink-800">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={clsx(
                "rounded-lg px-3 py-1.5 text-[12px] font-medium transition",
                mode === m.id ? "bg-white text-ink-900 shadow-sm dark:bg-ink-700 dark:text-ink-50" : "text-ink-500 dark:text-ink-400"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader
          title={floor?.label ?? "Floor"}
          subtitle="Room grid, colored by deviation from target temperature"
          action={<Legend mode={mode} />}
        />
        <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-3 lg:grid-cols-4">
          {roomList.map((r) => {
            const energy = roomEnergyKwh(r);
            const carbon = Math.round(energy * 0.24 * 10) / 10;
            const visual =
              mode === "temperature" ? tempColor(r.currentTempC, r.targetTempC) : levelColor(mode === "energy" ? energy : carbon, mode === "energy" ? maxEnergy : maxCarbon);
            const delta = r.currentTempC - r.targetTempC;
            return (
              <Link
                key={r.id}
                to={`/b/${buildingId}/rooms/${r.id}`}
                className={clsx(
                  "group relative rounded-xl border p-4 transition hover:shadow-md",
                  visual.cell
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <p className="text-[14px] font-medium">{r.label}</p>
                  {r.status === "anomaly" ? (
                    <AlertTriangle size={15} className="shrink-0 text-red-500" />
                  ) : r.status === "watch" ? (
                    <Eye size={15} className="shrink-0 text-amber-500" />
                  ) : (
                    <StatusBadge status="normal" label="" />
                  )}
                </div>
                <p className={clsx("mt-3 text-2xl font-medium", visual.text)}>
                  {mode === "temperature" ? `${r.currentTempC}°C` : `${(mode === "energy" ? energy : carbon).toFixed(1)}${mode === "energy" ? " kWh" : " kg"}`}
                </p>
                <p className="text-[12px] text-ink-400">
                  {mode === "temperature" ? `target ${r.targetTempC}°C · predicted ${r.predictedTempC}°C` : `${r.hvac.unitId} · ${r.hvac.status}`}
                </p>

                <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-56 -translate-x-1/2 rounded-xl border border-ink-100 bg-white p-3 shadow-xl dark:border-ink-700 dark:bg-ink-800 group-hover:block">
                  <p className="text-[13px] font-medium">{r.label}</p>
                  <dl className="mt-1.5 space-y-1 text-[12px]">
                    <div className="flex justify-between"><dt className="text-ink-400">Current</dt><dd>{r.currentTempC}°C</dd></div>
                    <div className="flex justify-between"><dt className="text-ink-400">Predicted</dt><dd>{r.predictedTempC}°C</dd></div>
                    <div className="flex justify-between"><dt className="text-ink-400">Target</dt><dd>{r.targetTempC}°C</dd></div>
                    <div className="flex justify-between"><dt className="text-ink-400">Δ</dt><dd className={clsx("font-medium", visual.text)}>{delta > 0 ? "+" : ""}{delta.toFixed(1)}°C</dd></div>
                    <div className="flex justify-between"><dt className="text-ink-400">AC unit</dt><dd className="font-mono">{r.hvac.unitId}</dd></div>
                    <div className="flex justify-between"><dt className="text-ink-400">Energy (24h)</dt><dd>{energy.toFixed(1)} kWh</dd></div>
                  </dl>
                </div>
              </Link>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
