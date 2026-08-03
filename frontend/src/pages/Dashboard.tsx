import { Link, useParams } from "react-router-dom";
import { AreaChart, Area, ResponsiveContainer, XAxis, Tooltip } from "recharts";
import { buildingById, energyLast24h, anomalies, floors, roomsByFloor } from "../data/mock";
import { Card, CardHeader, StatCard, StatusBadge } from "../components/ui";

export default function Dashboard() {
  const { buildingId = "esi-algiers" } = useParams();
  const building = buildingById(buildingId);
  const buildingFloors = floors.filter((f) => f.buildingId === buildingId);
  const openAnomalies = anomalies.filter((a) => a.status !== "resolved");

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-[20px] font-medium">Building dashboard</h1>
      <p className="mt-1 text-[13px] text-ink-400">Live status across {building?.floorsCount} floors, {building?.roomsCount} rooms.</p>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Energy saved" value={`${building?.energySavedPct}%`} delta="+7.5%" />
        <StatCard label="CO2 avoided" value={`${building?.co2AvoidedTonMonth} t/mo`} delta="-1.6%" positive={false} />
        <StatCard label="Active anomalies" value={String(openAnomalies.length)} delta={openAnomalies.length ? "needs review" : "all clear"} positive={openAnomalies.length === 0} />
        <StatCard label="Health score" value={`${building?.healthScore}%`} delta="+2 pts" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Energy consumption — last 24h" subtitle="Building-wide power draw" />
          <div className="h-56 px-2 pb-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={energyLast24h} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="kwh" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ee6c1f" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#ee6c1f" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="hour" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8c897d" }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e8e7e3", fontSize: 12 }} />
                <Area type="monotone" dataKey="kwh" stroke="#ee6c1f" strokeWidth={2} fill="url(#kwh)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Floors" subtitle="Tap to view a floor plan" />
          <div className="flex flex-col gap-2 px-5 pb-5">
            {buildingFloors.map((f) => {
              const floorRooms = roomsByFloor(f.id);
              const hasAnomaly = floorRooms.some((r) => r.status === "anomaly");
              return (
                <Link
                  key={f.id}
                  to={`/b/${buildingId}/floors/${f.id}`}
                  className="flex items-center justify-between rounded-xl border border-ink-100 px-4 py-3 transition hover:border-primary-300 dark:border-ink-800"
                >
                  <div>
                    <p className="text-[14px] font-medium">{f.label}</p>
                    <p className="text-[12px] text-ink-400">{floorRooms.length} rooms</p>
                  </div>
                  <StatusBadge status={hasAnomaly ? "anomaly" : "normal"} label={hasAnomaly ? "anomaly" : "normal"} />
                </Link>
              );
            })}
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Recent anomalies" subtitle="Predicted vs measured temperature mismatches" />
        <div className="divide-y divide-ink-100 dark:divide-ink-800">
          {anomalies.slice(0, 4).map((a) => (
            <Link
              key={a.id}
              to={`/b/${buildingId}/anomalies/${a.id}`}
              className="flex items-center justify-between px-5 py-3.5 transition hover:bg-ink-50 dark:hover:bg-ink-800"
            >
              <div>
                <p className="text-[14px] font-medium">{a.roomId}</p>
                <p className="text-[12px] text-ink-400">
                  Predicted {a.predictedC}°C · Measured {a.measuredC}°C · Δ {a.deltaC > 0 ? "+" : ""}
                  {a.deltaC}°C
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={a.severity} />
                <StatusBadge status={a.status} />
              </div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}