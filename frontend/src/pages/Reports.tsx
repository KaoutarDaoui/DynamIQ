import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useParams } from "react-router-dom";
import { buildingById, floors, roomsByFloor } from "../data/mock";
import { Card, CardHeader, StatCard, SecondaryButton } from "../components/ui";

const monthly = [
  { month: "Mar", savedKwh: 620, baselineKwh: 810 },
  { month: "Apr", savedKwh: 690, baselineKwh: 860 },
  { month: "May", savedKwh: 740, baselineKwh: 900 },
  { month: "Jun", savedKwh: 810, baselineKwh: 980 },
  { month: "Jul", savedKwh: 880, baselineKwh: 1040 },
];

export default function Reports() {
  const { buildingId = "esi-algiers" } = useParams();
  const building = buildingById(buildingId);
  const buildingFloors = floors.filter((f) => f.buildingId === buildingId);

  const leaderboard = buildingFloors
    .flatMap((f) => roomsByFloor(f.id).map((r) => ({ ...r, floorLabel: f.label })))
    .sort((a, b) => Math.abs(a.currentTempC - a.targetTempC) - Math.abs(b.currentTempC - b.targetTempC))
    .slice(0, 6);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-medium">Reports</h1>
          <p className="mt-1 text-[13px] text-ink-400">Energy, carbon and savings trends for {building?.name}.</p>
        </div>
        <SecondaryButton>Export PDF</SecondaryButton>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Energy saved (30d)" value="880 kWh" delta="+9%" />
        <StatCard label="CO2 avoided (30d)" value={`${building?.co2AvoidedTonMonth} t`} delta="+0.2 t" />
        <StatCard label="Cost avoided (30d)" value="18,400 DZD" delta="+6%" />
        <StatCard label="Avg comfort deviation" value="0.6°C" delta="-0.1°C" />
      </div>

      <Card className="mt-5">
        <CardHeader title="Actual vs baseline consumption" subtitle="Reactive baseline vs DynamIQ-optimized schedule, monthly kWh" />
        <div className="h-64 px-2 pb-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e8e7e3" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#8c897d" }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#8c897d" }} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e8e7e3", fontSize: 12 }} />
              <Bar dataKey="baselineKwh" fill="#d1cfc7" radius={[6, 6, 0, 0]} name="Baseline" />
              <Bar dataKey="savedKwh" fill="#ee6c1f" radius={[6, 6, 0, 0]} name="DynamIQ" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="mt-5">
        <CardHeader title="Efficiency leaderboard" subtitle="Rooms closest to their target temperature" />
        <div className="divide-y divide-ink-100 dark:divide-ink-800">
          {leaderboard.map((r, i) => (
            <div key={r.id} className="flex items-center justify-between px-5 py-3 text-[14px]">
              <div className="flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-50 text-[12px] font-medium text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">{i + 1}</span>
                <span className="font-medium">{r.label}</span>
                <span className="text-[12px] text-ink-400">{r.floorLabel}</span>
              </div>
              <span className="text-[12px] text-ink-600">Δ {Math.abs(r.currentTempC - r.targetTempC).toFixed(1)}°C from target</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}