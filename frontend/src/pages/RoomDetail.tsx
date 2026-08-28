import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { Minus, Plus, AlertTriangle } from "lucide-react";
import clsx from "clsx";
import { fetchAnomalies, fetchFloorHeatmap, fetchMpcSchedule, fetchSensorReadings, fetchThermalModels } from "../lib/api";
import type { LiveAnomalyOverview, MpcSchedule, SensorReadingPoint, ThermalModelRoom } from "../types";
import { Card, CardHeader, StatusBadge, SecondaryButton, PrimaryButton } from "../components/ui";

function isDark() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

function fmt(v: number | null | undefined, unit = ""): string {
  return v === null || v === undefined ? "—" : `${v.toFixed(1)}${unit}`;
}

export default function RoomDetail() {
  const { buildingId = "djezzy-hq", roomId = "" } = useParams();
  const [model, setModel] = useState<ThermalModelRoom | null>(null);
  const [schedule, setSchedule] = useState<MpcSchedule | null>(null);
  const [latestTempC, setLatestTempC] = useState<number | null>(null);
  const [roomEnergyKwh, setRoomEnergyKwh] = useState<number | null>(null);
  const [roomCarbonGco2, setRoomCarbonGco2] = useState<number | null>(null);
  const [hasOpenAnomaly, setHasOpenAnomaly] = useState(false);
  const [roomAnomalies, setRoomAnomalies] = useState<LiveAnomalyOverview[]>([]);
  const [sensorReadings, setSensorReadings] = useState<SensorReadingPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [setpoint, setSetpoint] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotFound(false);
    Promise.all([fetchThermalModels(buildingId), fetchMpcSchedule(buildingId, roomId), fetchAnomalies(buildingId)])
      .then(async ([models, sch, anoms]) => {
        if (!active) return;
        const found = models.find((m) => m.roomId === roomId) ?? null;
        if (!found) {
          setNotFound(true);
          return;
        }
        setModel(found);
        setSchedule(sch);
        if (sch) setSetpoint(sch.slots.length ? sch.slots[sch.slots.length - 1].setpointC : null);
        const roomAnoms = anoms.filter((a) => a.roomId === roomId);
        setRoomAnomalies(roomAnoms);
        setHasOpenAnomaly(roomAnoms.some((a) => a.status === "open" || a.status === "diagnosed"));
        if (found.isInstrumented) {
          try {
            const heat = await fetchFloorHeatmap(buildingId, found.floorLevel);
            const entry = heat.find((h) => h.roomId === roomId);
            if (entry && active) {
              setLatestTempC(entry.latestTempC);
              setRoomEnergyKwh(entry.energyKwh24h);
              setRoomCarbonGco2(entry.carbonGco2_24h);
            }
          } catch {
            // heatmap is best-effort
          }
          try {
            const readings = await fetchSensorReadings(buildingId, roomId, 48);
            if (active) setSensorReadings(readings);
          } catch {
            // sensor history is best-effort
          }
        }
      })
      .catch(() => {
        if (active) setNotFound(true);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [buildingId, roomId]);

  const chartData = useMemo(() => {
    if (!schedule) return [];
    return schedule.slots.map((s) => ({
      hour: new Date(s.slotTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      setpointC: s.setpointC,
      predictedC: s.predictedTempC,
      actualC: s.actualTempC,
    }));
  }, [schedule]);

  const sensorChartData = useMemo(
    () =>
      sensorReadings.map((r) => ({
        time: new Date(r.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
        measuredC: r.tempMeasuredC,
        extC: r.tempExtC,
      })),
    [sensorReadings]
  );

  const status = hasOpenAnomaly ? "anomaly" : model?.isInstrumented ? "online" : "offline";
  const currentTarget = setpoint ?? schedule?.slots[schedule.slots.length - 1]?.setpointC ?? null;

  if (loading) return <p className="mx-auto max-w-6xl text-[14px] text-ink-400">Loading room…</p>;
  if (notFound || !model) {
    return (
      <div className="mx-auto max-w-6xl">
        <p className="text-[14px] text-ink-400">Room not found.</p>
        <Link to={`/b/${buildingId}/floors/${model?.floorId ?? ""}`} className="mt-2 inline-block text-[13px] text-primary-600 hover:underline">
          ← Back to floors
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <p className="text-[12px] text-ink-400">
        <Link to={`/b/${buildingId}/floors/${model.floorId}`} className="hover:text-primary-600">Floor {model.floorLevel}</Link> / {model.roomLabel}
      </p>
      <div className="mt-1 flex items-center gap-3">
        <h1 className="text-[20px] font-medium">{model.roomLabel}</h1>
        <StatusBadge status={status} label={hasOpenAnomaly ? "anomaly" : model.isInstrumented ? "online" : "no sensor"} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="p-5">
          <p className="text-[13px] text-ink-400">Current temperature</p>
          <p className="mt-1 text-3xl font-medium">{latestTempC !== null ? `${latestTempC.toFixed(1)}°C` : "—"}</p>
          <p className="mt-1 text-[12px] text-ink-400">
            {latestTempC !== null ? `Setpoint ${fmt(currentTarget, "°C")}` : model.isInstrumented ? "No recent reading" : "No sensor installed"}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-[13px] text-ink-400">AC unit</p>
          <p className="mt-1 text-[18px] font-medium">
            {schedule?.capacityKw ? `Split · ${schedule.capacityKw.toFixed(1)} kW` : "Not configured"}
          </p>
          <p className="mt-1 text-[12px] text-ink-400">
            {schedule?.copCooling ? `COP ${schedule.copCooling.toFixed(1)}` : "No HVAC config"} {schedule ? `· solved ${new Date(schedule.solvedAt).toLocaleString()}` : ""}
          </p>
          <div className="mt-2"><StatusBadge status={schedule ? "online" : "offline"} label={schedule ? "mpc active" : "no schedule"} /></div>
        </Card>
        <Card className="p-5">
          <p className="text-[13px] text-ink-400">Room</p>
          <p className="mt-1 text-[18px] font-medium">{model.areaM2.toFixed(0)} m²</p>
          <p className="mt-1 text-[12px] text-ink-400">
            Floor {model.floorLevel} · {model.isCalibrated ? "model calibrated" : "not calibrated"}
          </p>
        </Card>
      </div>

      {model.isInstrumented && (
        <Card className="mt-5">
          <CardHeader title="Sensor readings" subtitle="Raw measured room temperature vs outdoor temperature, last 48h — straight from sensor_readings" />
          {sensorChartData.length > 0 ? (
            <div className="h-64 px-2 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sensorChartData} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                  <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#8c897d" }} minTickGap={40} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8c897d" }} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: isDark() ? "1px solid #3a392f" : "1px solid #e8e7e3", fontSize: 12, background: isDark() ? "#2a2925" : "#fff", color: isDark() ? "#f5f4f1" : "#23231f" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="measuredC" name="Measured °C" stroke="#ee6c1f" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="extC" name="Outdoor °C" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="px-5 pb-6 text-[13px] text-ink-400">No sensor readings in the last 48h.</p>
          )}
        </Card>
      )}

      <Card className="mt-5">
        <CardHeader title="24h MPC schedule" subtitle="Setpoint vs predicted temperature from the latest solve" />
        {schedule ? (
          <div className="h-64 px-2 pb-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                <XAxis dataKey="hour" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: isDark() ? "#8c897d" : "#8c897d" }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: isDark() ? "#8c897d" : "#8c897d" }} domain={["auto", "auto"]} />
                <Tooltip contentStyle={{ borderRadius: 12, border: isDark() ? "1px solid #3a392f" : "1px solid #e8e7e3", fontSize: 12, background: isDark() ? "#2a2925" : "#fff", color: isDark() ? "#f5f4f1" : "#23231f" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="setpointC" name="Setpoint °C" stroke="#ee6c1f" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="predictedC" name="Predicted °C" stroke="#1d9e75" strokeWidth={2} dot={false} strokeDasharray="4 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="px-5 pb-6 text-[13px] text-ink-400">No MPC schedule has been solved yet for this room.</p>
        )}
      </Card>

      <Card className="mt-5">
        <CardHeader title="Setpoint override" subtitle="MPC will hold the room near this target" action={<StatusBadge status={currentTarget !== null && setpoint !== null && setpoint !== schedule?.slots[schedule.slots.length - 1]?.setpointC ? "watch" : "online"} label={currentTarget !== null && setpoint !== null && setpoint !== schedule?.slots[schedule.slots.length - 1]?.setpointC ? "override" : "auto"} />} />
        {currentTarget !== null ? (
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 pb-5">
            <div className="flex items-center gap-3">
              <SecondaryButton onClick={() => setSetpoint((s) => Math.max(16, Math.round((s! - 0.5) * 10) / 10))} aria-label="Lower setpoint">
                <Minus size={15} />
              </SecondaryButton>
              <div className="text-center">
                <p className="text-3xl font-medium">{setpoint?.toFixed(1)}°C</p>
                <p className="text-[11px] text-ink-400">latest solve target {schedule?.slots[schedule.slots.length - 1]?.setpointC.toFixed(1)}°C</p>
              </div>
              <SecondaryButton onClick={() => setSetpoint((s) => Math.min(30, Math.round((s! + 0.5) * 10) / 10))} aria-label="Raise setpoint">
                <Plus size={15} />
              </SecondaryButton>
            </div>
            <div className="flex items-center gap-3">
              <p className="text-[12px] text-ink-400">
                Comfort band <span className="font-medium text-ink-700 dark:text-ink-200">{currentTarget - 1}°C – {currentTarget + 1}°C</span>
              </p>
              <PrimaryButton onClick={() => setSetpoint(schedule?.slots[schedule.slots.length - 1]?.setpointC ?? null)}>Reset to auto</PrimaryButton>
            </div>
          </div>
        ) : (
          <p className="px-5 pb-6 text-[13px] text-ink-400">No setpoint available until an MPC schedule is solved.</p>
        )}
      </Card>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="RC model parameters" subtitle={model.isCalibrated ? `Auto-calibrated · v${model.version ?? "?"}${model.calibratedAt ? ` · ${new Date(model.calibratedAt).toLocaleDateString()}` : ""}` : "Not calibrated — no sensor history yet"} />
          <dl className="divide-y divide-ink-100 px-5 pb-5 text-[14px] dark:divide-ink-800">
            <div className="flex justify-between py-2.5"><dt className="text-ink-400">R (lumped)</dt><dd className="font-medium">{model.rLumpedKPerW !== null ? `${model.rLumpedKPerW.toFixed(4)} K/W` : "—"}</dd></div>
            <div className="flex justify-between py-2.5"><dt className="text-ink-400">C (lumped)</dt><dd className="font-medium">{model.cLumpedJPerK !== null ? `${model.cLumpedJPerK.toLocaleString()} J/K` : "—"}</dd></div>
            <div className="flex justify-between py-2.5"><dt className="text-ink-400">Validation RMSE</dt><dd className="font-medium">{model.rmseValidationC !== null ? `${model.rmseValidationC.toFixed(3)}°C` : "—"}</dd></div>
            <div className="flex justify-between py-2.5"><dt className="text-ink-400">Anomaly threshold</dt><dd className="font-medium">{model.anomalyThresholdC !== null ? `${model.anomalyThresholdC.toFixed(2)}°C` : "—"}</dd></div>
            <div className="flex justify-between py-2.5"><dt className="text-ink-400">Sensor</dt><dd className="font-medium capitalize">{model.isInstrumented ? "installed" : "none"}</dd></div>
          </dl>
        </Card>
        <Card>
          <CardHeader title="Energy & emissions (24h)" subtitle="Predicted from the latest MPC solve" />
          <div className="px-5 pb-5">
            <div className="flex items-end justify-between rounded-xl border border-ink-100 p-4 dark:border-ink-800">
              <div>
                <p className="text-[12px] text-ink-400">Predicted energy</p>
                <p className="mt-1 text-2xl font-medium">{roomEnergyKwh !== null ? `${roomEnergyKwh.toFixed(1)} kWh` : "—"}</p>
              </div>
              <div className="text-right">
                <p className="text-[12px] text-ink-400">Predicted carbon</p>
                <p className="mt-1 text-2xl font-medium">{roomCarbonGco2 !== null ? `${(roomCarbonGco2 / 1000).toFixed(1)} kg` : "—"}</p>
              </div>
            </div>
            {roomEnergyKwh === null && <p className="mt-3 text-[12px] text-ink-400">Only available for instrumented rooms with solved MPC schedules.</p>}
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Anomaly history" subtitle={`${roomAnomalies.length} recorded for this room`} />
        {roomAnomalies.length > 0 ? (
          <div className="divide-y divide-ink-100 dark:divide-ink-800">
            {roomAnomalies.map((a) => (
              <Link
                key={a.anomalyId}
                to={`/b/${buildingId}/anomalies/${a.anomalyId}`}
                className="flex items-center justify-between px-5 py-3.5 transition hover:bg-ink-50 dark:hover:bg-ink-800"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300">
                    <AlertTriangle size={15} />
                  </span>
                  <div>
                    <p className="text-[14px] font-medium">Residual Δ {a.residualC !== null ? `${a.residualC > 0 ? "+" : ""}${a.residualC.toFixed(2)}°C` : "—"}</p>
                    <p className="text-[12px] text-ink-400">{new Date(a.openedAt).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={a.severity} />
                  <StatusBadge status={a.status} />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className={clsx("px-5 pb-5 text-[13px]", "text-ink-400")}>No anomalies recorded for this room — predictions are within tolerance.</p>
        )}
      </Card>
    </div>
  );
}