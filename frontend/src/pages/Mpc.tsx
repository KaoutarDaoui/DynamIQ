import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { AlertTriangle, RefreshCw, Timer, Zap } from "lucide-react";
import clsx from "clsx";
import { fetchMpcRooms, fetchMpcSchedule, ThermalApiError } from "../lib/api";
import type { MpcRoomSummary, MpcSchedule } from "../types";
import { Card, CardHeader } from "../components/ui";

function isDark() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

function formatHm(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function Mpc() {
  const { buildingId = "esi-algiers" } = useParams();
  const [rooms, setRooms] = useState<MpcRoomSummary[] | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<MpcSchedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [horizon, setHorizon] = useState<"6h" | "12h" | "24h">("24h");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchMpcRooms(buildingId, controller.signal)
      .then((r) => {
        setRooms(r);
        setSelectedRoomId((prev) => prev ?? r[0]?.roomId ?? null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ThermalApiError ? err.message : "Failed to load MPC rooms");
        setLoading(false);
      });
    return () => controller.abort();
  }, [buildingId, reloadKey]);

  useEffect(() => {
    if (!selectedRoomId) {
      if (rooms !== null) setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchMpcSchedule(buildingId, selectedRoomId, controller.signal)
      .then(setSchedule)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ThermalApiError ? err.message : "Failed to load MPC schedule");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [buildingId, selectedRoomId, reloadKey]);

  const slotIntervalMinutes = useMemo(() => {
    if (!schedule || schedule.slots.length < 2) return 15;
    return Math.round((new Date(schedule.slots[1].slotTs).getTime() - new Date(schedule.slots[0].slotTs).getTime()) / 60000);
  }, [schedule]);

  const slotsForHorizon = useMemo(() => {
    if (!schedule) return [];
    const n = horizon === "6h" ? Math.round(360 / slotIntervalMinutes) : horizon === "12h" ? Math.round(720 / slotIntervalMinutes) : schedule.slots.length;
    return schedule.slots.slice(0, n).map((s) => ({ ...s, hour: formatHm(s.slotTs) }));
  }, [schedule, horizon, slotIntervalMinutes]);

  const totalKwh = useMemo(() => slotsForHorizon.reduce((sum, s) => sum + s.predictedKwh, 0), [slotsForHorizon]);
  const totalGco2 = useMemo(() => slotsForHorizon.reduce((sum, s) => sum + s.predictedGco2, 0), [slotsForHorizon]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-medium">MPC schedule</h1>
          <p className="mt-1 text-[13px] text-ink-400">Model predictive control — the most recently solved setpoint trajectory, live from Agent 2.</p>
        </div>
        <div className="flex items-center gap-2">
          {rooms && rooms.length > 0 && (
            <select
              value={selectedRoomId ?? ""}
              onChange={(e) => setSelectedRoomId(e.target.value)}
              className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-[13px] text-ink-900 outline-none dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
            >
              {rooms.map((r) => (
                <option key={r.roomId} value={r.roomId}>
                  {r.roomLabel} (Floor {r.floorLevel})
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="flex items-center gap-1.5 rounded-xl border border-ink-200 px-3.5 py-2 text-[13px] font-medium text-ink-700 transition hover:bg-ink-50 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <Card className="mt-6 border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
          <p className="flex items-center gap-2 text-[13px] font-medium text-red-700 dark:text-red-300">
            <AlertTriangle size={15} /> {error}
          </p>
        </Card>
      )}

      {!error && !loading && rooms?.length === 0 && (
        <Card className="mt-6 p-6 text-[13px] text-ink-400">No room has an MPC solve yet for this building.</Card>
      )}

      {!error && schedule && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex gap-1 rounded-xl bg-ink-100 p-1 dark:bg-ink-800">
              {(["6h", "12h", "24h"] as const).map((h) => (
                <button
                  key={h}
                  onClick={() => setHorizon(h)}
                  className={clsx(
                    "rounded-lg px-3 py-1.5 text-[12px] font-medium transition",
                    horizon === h ? "bg-white text-ink-900 shadow-sm dark:bg-ink-700 dark:text-ink-50" : "text-ink-500 dark:text-ink-400"
                  )}
                >
                  {h}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="flex items-center gap-1.5 rounded-full bg-ink-50 px-2.5 py-1 text-[12px] text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                <Zap size={12} className="text-amber-500" /> Objective: min cost + {schedule.carbonWeightLambda}× carbon
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-ink-50 px-2.5 py-1 text-[12px] text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                <Timer size={12} className="text-primary-500" /> Solved {new Date(schedule.solvedAt).toLocaleString()} · v{schedule.modelVersion} · flat tariff {schedule.tariffCurrencyPerKwh} DZD/kWh
              </span>
            </div>
          </div>

          <Card className="mt-4">
            <CardHeader title="Planned vs actual room temperature" subtitle={`${horizon} look-ahead · ${schedule.roomLabel} · "Actual" only appears once a slot's time has passed`} />
            <div className="h-72 px-2 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={slotsForHorizon} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                  <XAxis dataKey="hour" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8c897d" }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8c897d" }} domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: isDark() ? "1px solid #3a392f" : "1px solid #e8e7e3",
                      fontSize: 12,
                      background: isDark() ? "#2a2925" : "#fff",
                      color: isDark() ? "#f5f4f1" : "#23231f",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="predictedTempC" name="Planned °C" stroke="#ee6c1f" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="actualTempC" name="Actual °C" stroke="#1d9e75" strokeWidth={2} dot={false} strokeDasharray="4 3" connectNulls={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="mt-5">
            <CardHeader
              title="Predicted energy & carbon"
              subtitle={`${totalKwh.toFixed(2)} kWh · ${totalGco2.toFixed(0)} gCO₂ over this window (no time-varying price signal in the current system — tariff is flat)`}
            />
            <div className="h-56 px-2 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={slotsForHorizon} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                  <XAxis dataKey="hour" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8c897d" }} />
                  <YAxis yAxisId="gco2" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8c897d" }} width={36} />
                  <YAxis yAxisId="kwh" orientation="right" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8c897d" }} width={36} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: isDark() ? "1px solid #3a392f" : "1px solid #e8e7e3",
                      fontSize: 12,
                      background: isDark() ? "#2a2925" : "#fff",
                      color: isDark() ? "#f5f4f1" : "#23231f",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line yAxisId="gco2" type="monotone" dataKey="predictedGco2" name="gCO₂ / slot" stroke="#1d9e75" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line yAxisId="kwh" type="monotone" dataKey="predictedKwh" name="kWh / slot" stroke="#ee6c1f" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
