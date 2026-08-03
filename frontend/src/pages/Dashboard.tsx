import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import {
  Building2,
  Zap,
  Leaf,
  AlertTriangle,
  HeartPulse,
  MapPin,
  Sun,
  Droplets,
  Wind,
  CheckCircle2,
  ChevronRight,
  Gauge,
} from "lucide-react";
import clsx from "clsx";
import { buildingById, dashboardSeries, anomalies, floors, roomsByFloor, roomById } from "../data/mock";
import type { ChartMetric, ChartRange } from "../data/mock";
import { Card, CardHeader, StatCard, StatusBadge } from "../components/ui";

function isDark() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

const RANGES: { id: ChartRange; label: string }[] = [
  { id: "24h", label: "24h" },
  { id: "7d", label: "7 Days" },
  { id: "30d", label: "30 Days" },
  { id: "custom", label: "Custom" },
];

const METRICS: { id: ChartMetric; label: string; color: string; unit: string }[] = [
  { id: "energy", label: "Energy", color: "#ee6c1f", unit: "kWh" },
  { id: "carbon", label: "Carbon", color: "#1d9e75", unit: "kg" },
  { id: "temperature", label: "Temperature", color: "#e24b4a", unit: "°C" },
];

function FloorRow({ buildingId, f }: { buildingId: string; f: { id: string; label: string } }) {
  const floorRooms = roomsByFloor(f.id);
  const alerts = floorRooms.filter((r) => r.status === "anomaly" || r.status === "watch").length;
  const hasAnomaly = floorRooms.some((r) => r.status === "anomaly");
  const hasWatch = floorRooms.some((r) => r.status === "watch");
  const dot = hasAnomaly ? "bg-red-500" : hasWatch ? "bg-amber-500" : "bg-teal-500";
  return (
    <Link
      to={`/b/${buildingId}/floors/${f.id}`}
      className="group flex items-center justify-between rounded-xl border border-ink-100 px-4 py-3 transition hover:border-primary-300 dark:border-ink-800"
    >
      <div className="flex items-center gap-3">
        <span className={clsx("h-2.5 w-2.5 shrink-0 rounded-full", dot)} />
        <div>
          <p className="text-[14px] font-medium">{f.label}</p>
          <p className="text-[12px] text-ink-400">
            {floorRooms.length} Rooms · {floorRooms.length} Sensors
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {alerts > 0 ? (
          <span className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[12px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
            <AlertTriangle size={12} /> {alerts} {alerts === 1 ? "Alert" : "Alerts"}
          </span>
        ) : (
          <span className="text-[12px] text-ink-400">No alerts</span>
        )}
        <span className="flex items-center gap-1 text-[12px] font-medium text-primary-600 transition group-hover:gap-1.5 dark:text-primary-400">
          View Heatmap <ChevronRight size={14} />
        </span>
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const { buildingId = "esi-algiers" } = useParams();
  const building = buildingById(buildingId);
  const buildingFloors = floors.filter((f) => f.buildingId === buildingId);
  const openAnomalies = anomalies.filter((a) => a.status !== "resolved");

  const [range, setRange] = useState<ChartRange>("24h");
  const [metric, setMetric] = useState<ChartMetric>("energy");
  const [customRange, setCustomRange] = useState<[string, string]>(["", ""]);

  if (!building) return <p className="text-[14px] text-ink-400">Building not found.</p>;

  const metricDef = METRICS.find((m) => m.id === metric)!;
  const rangeLabel = RANGES.find((r) => r.id === range)?.label ?? "24h";
  const series = range === "custom" ? dashboardSeries["30d"][metric] : dashboardSeries[range][metric];
  const chartTitle = `${metricDef.label} consumption — last ${rangeLabel.toLowerCase()}`;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="rounded-2xl border border-ink-100 bg-white p-6 shadow-sm dark:border-ink-800 dark:bg-ink-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-500 text-white">
                <Building2 size={22} />
              </span>
              <div>
                <h1 className="text-[22px] font-medium">{building.name}</h1>
                <p className="text-[13px] text-ink-400">AI-powered HVAC operation</p>
              </div>
            </div>
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-600 dark:text-ink-300">
              <MapPin size={14} className="text-ink-400" />
              {building.address} · {building.floorsCount} Floors · {building.roomsCount} Rooms
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
              <span className="text-ink-400">Health Score</span>
              <span className="font-medium text-ink-900 dark:text-white">{building.healthScore}%</span>
              <StatusBadge status={building.status} label={building.status} />
            </div>
            <p className="mt-2 text-[12px] text-ink-400">Last AI Optimization: {building.lastAiOptimization}</p>
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-ink-100 bg-ink-50 p-4 text-[13px] dark:border-ink-800 dark:bg-ink-800/50">
            <p className="flex items-center gap-2 text-ink-500 dark:text-ink-300">
              <Sun size={15} className="text-amber-500" /> {building.weather.tempC}°C · {building.weather.condition}
            </p>
            <p className="flex items-center gap-2 text-ink-500 dark:text-ink-300">
              <Droplets size={15} className="text-sky-500" /> Humidity {building.weather.humidityPct}%
            </p>
            <p className="flex items-center gap-2 text-ink-500 dark:text-ink-300">
              <Wind size={15} className="text-ink-400" /> Wind {building.weather.windKph} km/h
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Energy Saved"
          value={`${building.energySavedPct}%`}
          delta="+7.5%"
          icon={<Zap size={16} />}
          accent="bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300"
        />
        <StatCard
          label="CO₂ Avoided"
          value={`${building.co2AvoidedTonMonth} t/mo`}
          delta="-1.6%"
          positive={false}
          icon={<Leaf size={16} />}
          accent="bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300"
        />
        <StatCard
          label="Active Anomalies"
          value={String(openAnomalies.length)}
          delta={openAnomalies.length ? "needs review" : "all clear"}
          positive={openAnomalies.length === 0}
          icon={<AlertTriangle size={16} />}
          accent={
            openAnomalies.length > 0
              ? "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300"
              : "bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300"
          }
        />
        <StatCard
          label="Health Score"
          value={`${building.healthScore}%`}
          delta="+2 pts"
          icon={<HeartPulse size={16} />}
          accent="bg-primary-50 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={chartTitle} subtitle="Building-wide telemetry" />
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3">
            <div className="flex gap-1 rounded-xl bg-ink-100 p-1 dark:bg-ink-800">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRange(r.id as ChartRange)}
                  className={clsx(
                    "rounded-lg px-3 py-1.5 text-[12px] font-medium transition",
                    range === r.id ? "bg-white text-ink-900 shadow-sm dark:bg-ink-700 dark:text-ink-50" : "text-ink-500 dark:text-ink-400"
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1 rounded-xl bg-ink-100 p-1 dark:bg-ink-800">
              {METRICS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMetric(m.id)}
                  className={clsx(
                    "rounded-lg px-3 py-1.5 text-[12px] font-medium transition",
                    metric === m.id ? "bg-white text-ink-900 shadow-sm dark:bg-ink-700 dark:text-ink-50" : "text-ink-500 dark:text-ink-400"
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {range === "custom" && (
            <div className="flex items-center gap-3 px-5 pb-3 text-[12px] text-ink-400">
              <label className="flex items-center gap-1.5">
                From
                <input
                  type="date"
                  value={customRange[0]}
                  onChange={(e) => setCustomRange((c) => [e.target.value, c[1]])}
                  className="rounded-lg border border-ink-200 bg-white px-2 py-1 dark:border-ink-700 dark:bg-ink-900"
                />
              </label>
              <label className="flex items-center gap-1.5">
                To
                <input
                  type="date"
                  value={customRange[1]}
                  onChange={(e) => setCustomRange((c) => [c[0], e.target.value])}
                  className="rounded-lg border border-ink-200 bg-white px-2 py-1 dark:border-ink-700 dark:bg-ink-900"
                />
              </label>
              <span className="text-ink-400">Showing last 30 days</span>
            </div>
          )}

          <div className="h-56 px-2 pb-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="metric" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={metricDef.color} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={metricDef.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8c897d" }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8c897d" }} width={36} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: isDark() ? "1px solid #3a392f" : "1px solid #e8e7e3",
                    fontSize: 12,
                    background: isDark() ? "#2a2925" : "#fff",
                    color: isDark() ? "#f5f4f1" : "#23231f",
                  }}
                  formatter={(value) => [`${value} ${metricDef.unit}`, metricDef.label]}
                />
                <Area type="monotone" dataKey="value" stroke={metricDef.color} strokeWidth={2} fill="url(#metric)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Outside conditions" subtitle="Weather Agent input" />
            <div className="grid grid-cols-2 gap-3 px-5 pb-5">
              <div className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800/50">
                <p className="flex items-center gap-1.5 text-[12px] text-ink-400">
                  <Sun size={13} className="text-amber-500" /> Temperature
                </p>
                <p className="mt-1 text-xl font-medium">{building.weather.tempC}°C</p>
              </div>
              <div className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800/50">
                <p className="flex items-center gap-1.5 text-[12px] text-ink-400">
                  <Droplets size={13} className="text-sky-500" /> Humidity
                </p>
                <p className="mt-1 text-xl font-medium">{building.weather.humidityPct}%</p>
              </div>
              <div className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800/50">
                <p className="flex items-center gap-1.5 text-[12px] text-ink-400">
                  <Wind size={13} className="text-ink-400" /> Wind
                </p>
                <p className="mt-1 text-xl font-medium">{building.weather.windKph} km/h</p>
              </div>
              <div className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800/50">
                <p className="flex items-center gap-1.5 text-[12px] text-ink-400">
                  <Sun size={13} className="text-amber-400" /> Solar
                </p>
                <p className="mt-1 text-xl font-medium capitalize">{building.weather.solar}</p>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="AI status" subtitle="Model health" />
            <div className="px-5 pb-5">
              <div className="flex flex-col gap-2.5">
                {[
                  { label: "Thermal Model", note: "Calibrated" },
                  { label: "MPC Running", note: "24h horizon" },
                  { label: "Prediction Updated", note: "12 min ago" },
                ].map((s) => (
                  <div key={s.label} className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[13px] text-ink-700 dark:text-ink-200">
                      <CheckCircle2 size={15} className="text-teal-500" /> {s.label}
                    </span>
                    <span className="text-[12px] text-ink-400">{s.note}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between rounded-xl bg-ink-50 px-3 py-2.5 dark:bg-ink-800/50">
                <span className="flex items-center gap-2 text-[12px] font-medium text-ink-600 dark:text-ink-300">
                  <Gauge size={14} className="text-primary-500" /> Next calibration
                </span>
                <span className="text-[12px] font-medium text-ink-900 dark:text-white">in 3 hours</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Card className="mt-5">
        <CardHeader title="Floors" subtitle="Tap a floor to open its heatmap" />
        <div className="flex flex-col gap-2 px-5 pb-5">
          {buildingFloors.map((f) => (
            <FloorRow key={f.id} buildingId={buildingId} f={f} />
          ))}
        </div>
      </Card>

      <Card className="mt-5">
        <CardHeader title="Recent anomalies" subtitle="Predicted vs measured temperature mismatches" />
        <div className="divide-y divide-ink-100 dark:divide-ink-800">
          {anomalies.slice(0, 4).map((a) => {
            const room = roomById(a.roomId);
            return (
              <Link
                key={a.id}
                to={`/b/${buildingId}/anomalies/${a.id}`}
                className="group flex items-center justify-between px-5 py-3.5 transition hover:bg-ink-50 dark:hover:bg-ink-800"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={clsx(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                      a.severity === "high"
                        ? "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300"
                        : a.severity === "medium"
                          ? "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300"
                          : "bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-300"
                    )}
                  >
                    <AlertTriangle size={16} />
                  </span>
                  <div>
                    <p className="text-[14px] font-medium">{room?.label ?? a.roomId}</p>
                    <p className="text-[12px] text-ink-400">Prediction error · Δ {a.deltaC > 0 ? "+" : ""}{a.deltaC}°C</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={clsx(
                      "rounded-full px-2.5 py-1 text-[12px] font-semibold",
                      a.deltaC > 2
                        ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                    )}
                  >
                    {a.deltaC > 0 ? "+" : ""}{a.deltaC}°C
                  </span>
                  <StatusBadge status={a.status} />
                  <span className="flex items-center gap-1 text-[12px] font-medium text-primary-600 transition group-hover:gap-1.5 dark:text-primary-400">
                    View details <ChevronRight size={14} />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
