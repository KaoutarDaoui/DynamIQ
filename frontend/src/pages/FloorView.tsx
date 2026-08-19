import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import clsx from "clsx";
import { AlertTriangle, Eye } from "lucide-react";
import { fetchFloorHeatmap, fetchThermalModels } from "../lib/api";
import type { HeatmapRoom, ThermalModelRoom } from "../types";
import { Card, CardHeader, StatusBadge } from "../components/ui";

type ViewMode = "temperature" | "energy" | "carbon";

const MODES: { id: ViewMode; label: string }[] = [
  { id: "temperature", label: "Temperature" },
  { id: "energy", label: "Energy" },
  { id: "carbon", label: "Carbon" },
];

function tempColor(delta: number | null) {
  if (delta === null) return { cell: "bg-ink-50 border-ink-200 dark:bg-ink-800/60 dark:border-ink-700", text: "text-ink-400" };
  if (delta > 2) return { cell: "bg-red-500/15 border-red-500/40", text: "text-red-700 dark:text-red-300" };
  if (delta > 0.8) return { cell: "bg-amber-500/15 border-amber-500/40", text: "text-amber-700 dark:text-amber-300" };
  return { cell: "bg-teal-500/12 border-teal-500/35", text: "text-teal-700 dark:text-teal-300" };
}

function levelColor(v: number, max: number) {
  if (max <= 0) return { cell: "bg-ink-50 border-ink-200 dark:bg-ink-800/60 dark:border-ink-700", text: "text-ink-400" };
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
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-ink-200" /> No sensor</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-[12px] text-ink-500 dark:text-ink-300">
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-teal-500/60" /> Low</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500/60" /> Medium</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500/60" /> High</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-ink-200" /> No data</span>
    </div>
  );
}

export default function FloorView() {
  const { buildingId = "djezzy-hq", floorId } = useParams();
  const [mode, setMode] = useState<ViewMode>("temperature");
  const [models, setModels] = useState<ThermalModelRoom[]>([]);
  const [rooms, setRooms] = useState<HeatmapRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchThermalModels(buildingId)
      .then((m) => {
        if (active) setModels(m);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : "Failed to load floors");
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [buildingId]);

  const floors = useMemo(() => {
    const byLevel = new Map<number, { floorId: string; level: number }>();
    for (const m of models) {
      if (!byLevel.has(m.floorLevel)) byLevel.set(m.floorLevel, { floorId: m.floorId, level: m.floorLevel });
    }
    return [...byLevel.values()].sort((a, b) => a.level - b.level);
  }, [models]);

  const currentFloor = useMemo(() => {
    if (!floors.length) return null;
    return floors.find((f) => f.floorId === floorId) ?? floors[0];
  }, [floors, floorId]);

  useEffect(() => {
    if (!currentFloor) return;
    let active = true;
    setLoading(true);
    setError(null);
    fetchFloorHeatmap(buildingId, currentFloor.level)
      .then((r) => {
        if (active) setRooms(r);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : "Failed to load heatmap");
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [buildingId, currentFloor?.level, currentFloor?.floorId]);

  const maxEnergy = useMemo(() => Math.max(0.1, ...rooms.map((r) => r.energyKwh24h)), [rooms]);
  const maxCarbon = useMemo(() => Math.max(0.1, ...rooms.map((r) => r.carbonGco2_24h / 1000)), [rooms]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {floors.map((f) => (
          <Link
            key={f.floorId}
            to={`/b/${buildingId}/floors/${f.floorId}`}
            className={clsx(
              "rounded-full px-3.5 py-1.5 text-[13px] font-medium",
              f.floorId === currentFloor?.floorId ? "bg-primary-500 text-white" : "bg-white border border-ink-100 text-ink-600 hover:border-primary-300 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-300 dark:hover:border-primary-600"
            )}
          >
            Floor {f.level}
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
          title={`Floor ${currentFloor?.level ?? "—"}`}
          subtitle={mode === "temperature" ? "Room grid, colored by measured vs setpoint deviation" : mode === "energy" ? "Predicted energy consumption over the last 24h" : "Predicted carbon emissions over the last 24h"}
          action={<Legend mode={mode} />}
        />
        {loading ? (
          <p className="px-5 pb-6 text-center text-[13px] text-ink-400">Loading heatmap…</p>
        ) : error ? (
          <p className="px-5 pb-6 text-center text-[13px] text-red-500">{error}</p>
        ) : rooms.length === 0 ? (
          <p className="px-5 pb-6 text-center text-[13px] text-ink-400">No rooms on this floor.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-3 lg:grid-cols-4">
            {rooms.map((r) => {
              const delta = r.latestTempC !== null && r.setpointC !== null ? r.latestTempC - r.setpointC : null;
              const energy = r.energyKwh24h;
              const carbon = r.carbonGco2_24h / 1000;
              const visual =
                mode === "temperature"
                  ? tempColor(delta)
                  : levelColor(mode === "energy" ? energy : carbon, mode === "energy" ? maxEnergy : maxCarbon);
              return (
                <Link
                  key={r.roomId}
                  to={`/b/${buildingId}/rooms/${r.roomId}`}
                  className={clsx("group relative rounded-xl border p-4 transition hover:shadow-md", visual.cell)}
                >
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-[14px] font-medium">{r.roomLabel}</p>
                    {r.hasOpenAnomaly ? (
                      <AlertTriangle size={15} className="shrink-0 text-red-500" />
                    ) : r.latestTempC !== null ? (
                      <StatusBadge status="normal" label="" />
                    ) : (
                      <Eye size={15} className="shrink-0 text-ink-300" />
                    )}
                  </div>
                  <p className={clsx("mt-3 text-2xl font-medium", visual.text)}>
                    {mode === "temperature"
                      ? r.latestTempC !== null
                        ? `${r.latestTempC.toFixed(1)}°C`
                        : "—"
                      : `${(mode === "energy" ? energy : carbon).toFixed(1)}${mode === "energy" ? " kWh" : " kg"}`}
                  </p>
                  <p className="text-[12px] text-ink-400">
                    {mode === "temperature"
                      ? r.setpointC !== null
                        ? `setpoint ${r.setpointC.toFixed(1)}°C${r.predictedTempC !== null ? ` · predicted ${r.predictedTempC.toFixed(1)}°C` : ""}`
                        : "no sensor"
                      : `${r.areaM2.toFixed(0)} m²`}
                  </p>

                  <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-56 -translate-x-1/2 rounded-xl border border-ink-100 bg-white p-3 shadow-xl dark:border-ink-700 dark:bg-ink-800 group-hover:block">
                    <p className="text-[13px] font-medium">{r.roomLabel}</p>
                    <dl className="mt-1.5 space-y-1 text-[12px]">
                      <div className="flex justify-between"><dt className="text-ink-400">Measured</dt><dd>{r.latestTempC !== null ? `${r.latestTempC.toFixed(1)}°C` : "No sensor"}</dd></div>
                      <div className="flex justify-between"><dt className="text-ink-400">Predicted</dt><dd>{r.predictedTempC !== null ? `${r.predictedTempC.toFixed(1)}°C` : "—"}</dd></div>
                      <div className="flex justify-between"><dt className="text-ink-400">Setpoint</dt><dd>{r.setpointC !== null ? `${r.setpointC.toFixed(1)}°C` : "—"}</dd></div>
                      <div className="flex justify-between"><dt className="text-ink-400">Δ</dt><dd className={clsx("font-medium", visual.text)}>{delta !== null ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)}°C` : "—"}</dd></div>
                      <div className="flex justify-between"><dt className="text-ink-400">Energy (24h)</dt><dd>{energy.toFixed(1)} kWh</dd></div>
                      <div className="flex justify-between"><dt className="text-ink-400">Carbon (24h)</dt><dd>{carbon.toFixed(1)} kg</dd></div>
                      <div className="flex justify-between"><dt className="text-ink-400">Area</dt><dd>{r.areaM2.toFixed(0)} m²</dd></div>
                    </dl>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}