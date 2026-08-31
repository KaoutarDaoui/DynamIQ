import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import {
  Building2,
  Zap,
  AlertTriangle,
  HeartPulse,
  MapPin,
  Gauge,
  Thermometer,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import clsx from "clsx";
import {
  fetchOrgBuildings,
  fetchAnomalies,
  fetchReportsSummary,
  fetchThermalModels,
  fetchMpcRooms,
  ThermalApiError,
} from "../lib/api";
import type { LiveAnomalyOverview, ReportsSummary } from "../types";
import { Card, CardHeader, StatusBadge } from "../components/ui";

function isDark() {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
  );
}

const RANGES: { id: string; label: string; days: number }[] = [
  { id: "7d", label: "7 Days", days: 7 },
  { id: "30d", label: "30 Days", days: 30 },
  { id: "custom", label: "Custom", days: 30 },
];

const METRICS: {
  id: "energy" | "carbon";
  label: string;
  color: string;
  unit: string;
}[] = [
  { id: "energy", label: "Energy", color: "#ee6c1f", unit: "kWh" },
  { id: "carbon", label: "Carbon", color: "#1d9e75", unit: "kg" },
];

type RiskLevel = "safe" | "warn" | "danger";

const RISK_TONES: Record<RiskLevel, string> = {
  safe: "text-teal-600 dark:text-teal-300",
  warn: "text-amber-600 dark:text-amber-400",
  danger: "text-red-600 dark:text-red-400",
};

function formatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(dateString: string): string {
  const diff = Date.now() - new Date(dateString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function Kpi({
  label,
  value,
  risk,
}: {
  label: string;
  value: string;
  risk: RiskLevel;
}) {
  const tone = RISK_TONES[risk];
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-ink-100 bg-white p-5 text-center shadow-sm dark:border-ink-800 dark:bg-ink-900">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">
        {label}
      </p>
      <p className={`text-3xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

export default function Dashboard() {
  const { buildingId = "esi-algiers" } = useParams();
  const [anomalies, setAnomalies] = useState<LiveAnomalyOverview[] | null>(
    null,
  );
  const [report, setReport] = useState<ReportsSummary | null>(null);
  const [building, setBuilding] = useState<{
    name: string;
    address: string;
    floors: number;
    rooms: number;
  } | null>(null);
  const [calibratedCount, setCalibratedCount] = useState(0);
  const [instrumentedCount, setInstrumentedCount] = useState(0);
  const [mpcRooms, setMpcRooms] = useState<
    { roomId: string; latestSolvedAt: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const [range, setRange] = useState<string>("7d");
  const [metric, setMetric] = useState<"energy" | "carbon">("energy");
  const [customRange, setCustomRange] = useState<[string, string]>(["", ""]);

  const days = RANGES.find((r) => r.id === range)?.days ?? 7;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const realBuilding = fetchOrgBuildings()
      .then((list) => {
        const b = list.find((x) => x.building_id === buildingId);
        if (b)
          setBuilding({
            name: b.name,
            address: b.address ?? "-",
            floors: b.total_floors,
            rooms: b.rooms_count,
          });
      })
      .catch(() => undefined);

    const anomaliesP = fetchAnomalies(buildingId, controller.signal)
      .then(setAnomalies)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          err instanceof ThermalApiError
            ? err.message
            : "Failed to load anomalies",
        );
      });

    const reportP = fetchReportsSummary(buildingId, days, controller.signal)
      .then(setReport)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          err instanceof ThermalApiError
            ? err.message
            : "Failed to load reports",
        );
      });

    const modelsP = fetchThermalModels(buildingId, controller.signal)
      .then((models) => {
        setInstrumentedCount(models.length);
        setCalibratedCount(models.filter((m) => m.isCalibrated).length);
      })
      .catch(() => undefined);

    const mpcP = fetchMpcRooms(buildingId, controller.signal)
      .then((rooms) => setMpcRooms(rooms))
      .catch(() => undefined);

    Promise.all([realBuilding, anomaliesP, reportP, modelsP, mpcP]).finally(
      () => {
        if (!controller.signal.aborted) setLoading(false);
      },
    );
    return () => controller.abort();
  }, [buildingId, reloadKey, days]);

  const openAnomalies = useMemo(
    () => (anomalies ?? []).filter((a) => a.status !== "resolved"),
    [anomalies],
  );
  const recentAnomalies = useMemo(
    () =>
      [...(anomalies ?? [])]
        .sort((a, b) => +new Date(b.openedAt) - +new Date(a.openedAt))
        .slice(0, 4),
    [anomalies],
  );

  const metricDef = METRICS.find((m) => m.id === metric)!;
  const rangeLabel = RANGES.find((r) => r.id === range)?.label ?? "7 days";
  const chartTitle = `${metricDef.label} consumption — last ${rangeLabel.toLowerCase()}`;

  const chartData = useMemo(() => {
    const daily = report?.daily ?? [];
    return daily.map((d) => ({
      label: d.date,
      value: metric === "energy" ? d.kwh : d.gco2 / 1000,
    }));
  }, [report, metric]);

  const totalKwh = report?.totalPredictedKwh ?? 0;
  const totalGco2 = report?.totalPredictedGco2 ?? 0;
  const avgDeviation = report?.avgComfortDeviationC ?? null;
  const latestMpcSolve = mpcRooms.length
    ? mpcRooms
        .map((r) => r.latestSolvedAt)
        .sort((a, b) => +new Date(b) - +new Date(a))[0]
    : null;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-medium">Dashboard</h1>
          <p className="mt-1 text-[13px] text-ink-400">
            Building telemetry, AI model health and live anomaly feed — real
            agent data, not mocked.
          </p>
        </div>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-ink-200 px-3.5 py-2 text-[13px] font-medium text-ink-700 transition hover:bg-ink-50 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && (
        <Card className="mt-6 border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
          <p className="flex items-center gap-2 text-[13px] font-medium text-red-700 dark:text-red-300">
            <AlertTriangle size={15} /> {error}
          </p>
        </Card>
      )}

      <div className="mt-6 rounded-2xl border border-ink-100 bg-white p-6 shadow-sm dark:border-ink-800 dark:bg-ink-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-500 text-white">
                <Building2 size={22} />
              </span>
              <div>
                <h1 className="text-[22px] font-medium">
                  {building?.name ?? (loading ? "Loading…" : buildingId)}
                </h1>
                <p className="text-[13px] text-ink-400">
                  AI-powered HVAC operation
                </p>
              </div>
            </div>
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-600 dark:text-ink-300">
              <MapPin size={14} className="text-ink-400" />
              {building
                ? `${building.address} · ${building.floors} Floors · ${building.rooms} Rooms`
                : "Fetching building metadata…"}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi
          label="Predicted Energy"
          value={loading ? "—" : `${totalKwh.toFixed(1)} kWh`}
          risk={totalKwh <= 0 ? "safe" : totalKwh <= 50 ? "warn" : "danger"}
        />
        <Kpi
          label="Predicted CO₂"
          value={loading ? "—" : `${(totalGco2 / 1000).toFixed(1)} kg`}
          risk={totalGco2 <= 0 ? "safe" : "warn"}
        />
        <Kpi
          label="Active Anomalies"
          value={loading ? "—" : String(openAnomalies.length)}
          risk={
            openAnomalies.length === 0
              ? "safe"
              : openAnomalies.length <= 2
                ? "warn"
                : "danger"
          }
        />
        <Kpi
          label="Avg Comfort Deviation"
          value={
            loading
              ? "—"
              : avgDeviation !== null
                ? `${avgDeviation.toFixed(1)}°C`
                : "—"
          }
          risk={
            avgDeviation === null
              ? "safe"
              : avgDeviation <= 1
                ? "safe"
                : avgDeviation <= 2
                  ? "warn"
                  : "danger"
          }
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={chartTitle} />
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3">
            <div className="flex gap-1 rounded-xl bg-ink-100 p-1 dark:bg-ink-800">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRange(r.id)}
                  className={clsx(
                    "rounded-lg px-3 py-1.5 text-[12px] font-medium transition",
                    range === r.id
                      ? "bg-white text-ink-900 shadow-sm dark:bg-ink-700 dark:text-ink-50"
                      : "text-ink-500 dark:text-ink-400",
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
                    metric === m.id
                      ? "bg-white text-ink-900 shadow-sm dark:bg-ink-700 dark:text-ink-50"
                      : "text-ink-500 dark:text-ink-400",
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
                  onChange={(e) =>
                    setCustomRange((c) => [e.target.value, c[1]])
                  }
                  className="rounded-lg border border-ink-200 bg-white px-2 py-1 dark:border-ink-700 dark:bg-ink-900"
                />
              </label>
              <label className="flex items-center gap-1.5">
                To
                <input
                  type="date"
                  value={customRange[1]}
                  onChange={(e) =>
                    setCustomRange((c) => [c[0], e.target.value])
                  }
                  className="rounded-lg border border-ink-200 bg-white px-2 py-1 dark:border-ink-700 dark:bg-ink-900"
                />
              </label>
              <span className="text-ink-400">
                Showing last 30 days of MPC predictions
              </span>
            </div>
          )}

          <div className="h-56 px-2 pb-4">
            {loading ? (
              <div className="flex h-full items-center justify-center text-[13px] text-ink-400">
                Loading telemetry…
              </div>
            ) : chartData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[13px] text-ink-400">
                No MPC predictions in this window yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ left: 0, right: 12, top: 8, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="metric" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor={metricDef.color}
                        stopOpacity={0.35}
                      />
                      <stop
                        offset="100%"
                        stopColor={metricDef.color}
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: "#8c897d" }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: "#8c897d" }}
                    width={48}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: isDark()
                        ? "1px solid #3a392f"
                        : "1px solid #e8e7e3",
                      fontSize: 12,
                      background: isDark() ? "#2a2925" : "#fff",
                      color: isDark() ? "#f5f4f1" : "#23231f",
                    }}
                    formatter={(value) => [
                      `${value} ${metricDef.unit}`,
                      metricDef.label,
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={metricDef.color}
                    strokeWidth={2}
                    fill="url(#metric)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader
              title="AI model health"
              subtitle="Calibration & MPC solve status"
            />
            <div className="px-5 pb-5">
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[13px] text-ink-700 dark:text-ink-200">
                    <Gauge size={15} className="text-primary-500" /> Rooms
                    instrumented & calibrated
                  </span>
                  <span className="text-[12px] font-medium text-ink-900 dark:text-white">
                    {loading ? "—" : `${calibratedCount}/${instrumentedCount}`}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[13px] text-ink-700 dark:text-ink-200">
                    <Zap size={15} className="text-amber-500" /> MPC solved
                    rooms
                  </span>
                  <span className="text-[12px] font-medium text-ink-900 dark:text-white">
                    {loading ? "—" : String(mpcRooms.length)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[13px] text-ink-700 dark:text-ink-200">
                    <HeartPulse size={15} className="text-teal-500" /> Latest
                    MPC solve
                  </span>
                  <span className="text-[12px] font-medium text-ink-900 dark:text-white">
                    {loading
                      ? "—"
                      : latestMpcSolve
                        ? timeAgo(latestMpcSolve)
                        : "—"}
                  </span>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Comfort tracking"
              subtitle="Rooms by deviation from the comfort band midpoint (23°C)"
            />
            <div className="px-5 pb-5">
              {(report?.comfortLeaderboard ?? []).slice(0, 4).map((r, i) => (
                <div
                  key={r.roomId}
                  className="flex items-center justify-between py-1.5 text-[13px]"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-50 text-[11px] font-medium text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                      {i + 1}
                    </span>
                    <span className="truncate font-medium text-ink-700 dark:text-ink-200">
                      {r.roomLabel}
                    </span>
                  </div>
                  <span
                    className={clsx(
                      "tabular-nums",
                      r.deviationC > 2
                        ? "text-red-600 dark:text-red-300"
                        : r.deviationC > 1
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-teal-600 dark:text-teal-300",
                    )}
                  >
                    Δ {r.deviationC.toFixed(1)}°C
                  </span>
                </div>
              ))}
              {(report?.comfortLeaderboard ?? []).length === 0 && !loading && (
                <p className="py-4 text-center text-[12px] text-ink-400">
                  No instrumented rooms with readings yet.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Card className="mt-5">
        <CardHeader
          title="Recent anomalies"
          subtitle="Predicted vs measured temperature mismatches"
        />
        <div className="divide-y divide-ink-100 dark:divide-ink-800">
          {loading && (
            <p className="px-5 py-6 text-center text-[13px] text-ink-400">
              Loading anomalies…
            </p>
          )}
          {!loading && recentAnomalies.length === 0 && (
            <p className="px-5 py-6 text-center text-[13px] text-ink-400">
              No anomalies recorded yet.
            </p>
          )}
          {recentAnomalies.map((a) => (
            <Link
              key={a.anomalyId}
              to={`/b/${buildingId}/anomalies/${a.anomalyId}`}
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
                        : "bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-300",
                  )}
                >
                  <Thermometer size={16} />
                </span>
                <div>
                  <p className="text-[14px] font-medium">{a.roomLabel}</p>
                  <p className="text-[12px] text-ink-400">
                    {formatKey(a.anomalyType)} ·{" "}
                    {a.residualC !== null && a.thresholdC !== null
                      ? `Δ ${a.residualC.toFixed(2)}°C vs ${a.thresholdC.toFixed(2)}°C`
                      : "opened " + new Date(a.openedAt).toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {a.cause && (
                  <span className="hidden text-[12px] text-ink-400 sm:inline">
                    {formatKey(a.cause)}
                  </span>
                )}
                <StatusBadge status={a.status} label={a.status} />
                <span className="flex items-center gap-1 text-[12px] font-medium text-primary-600 transition group-hover:gap-1.5 dark:text-primary-400">
                  View details <ChevronRight size={14} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
