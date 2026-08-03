import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { ChevronRight } from "lucide-react";
import clsx from "clsx";
import { anomalies, roomById } from "../data/mock";
import { Card, CardHeader, StatusBadge } from "../components/ui";
import type { AnomalySeverity, AnomalyStatusType } from "../types";

function isDark() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

const SEVERITIES: { id: AnomalySeverity | "all"; label: string }[] = [
  { id: "all", label: "All severities" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];
const STATUSES: { id: AnomalyStatusType | "all"; label: string }[] = [
  { id: "all", label: "All statuses" },
  { id: "open", label: "Open" },
  { id: "diagnosing", label: "Diagnosing" },
  { id: "diagnosed", label: "Diagnosed" },
  { id: "resolved", label: "Resolved" },
];
const severityDot: Record<AnomalySeverity, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-teal-500",
};

export default function Anomalies() {
  const { buildingId = "esi-algiers" } = useParams();
  const [sev, setSev] = useState<AnomalySeverity | "all">("all");
  const [status, setStatus] = useState<AnomalyStatusType | "all">("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "largest">("newest");

  const filtered = useMemo(() => {
    const list = anomalies.filter((a) => (sev === "all" || a.severity === sev) && (status === "all" || a.status === status));
    return [...list].sort((a, b) => {
      if (sort === "newest") return +new Date(b.raisedAt) - +new Date(a.raisedAt);
      if (sort === "oldest") return +new Date(a.raisedAt) - +new Date(b.raisedAt);
      return Math.abs(b.deltaC) - Math.abs(a.deltaC);
    });
  }, [sev, status, sort]);

  const chartData = useMemo(
    () =>
      filtered.slice(0, 8).map((a) => ({
        name: roomById(a.roomId)?.label ?? a.roomId,
        predicted: a.predictedC,
        measured: a.measuredC,
      })),
    [filtered]
  );

  const selectCls = "rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-[13px] text-ink-700 outline-none dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200";

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-[20px] font-medium">Anomalies</h1>
      <p className="mt-1 text-[13px] text-ink-400">Raised whenever a room's measured temperature diverges from thermal prediction.</p>

      <Card className="mt-6">
        <CardHeader title="Predicted vs measured" subtitle="Chart shows up to 8 filtered anomalies" />
        <div className="h-56 px-2 pb-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ left: 6, right: 12, top: 8, bottom: 0 }}>
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#8c897d" }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8c897d" }} width={34} domain={[20, 28]} />
              <Tooltip
                cursor={{ fill: isDark() ? "#2a2925" : "#f5f4f1" }}
                contentStyle={{
                  borderRadius: 12,
                  border: isDark() ? "1px solid #3a392f" : "1px solid #e8e7e3",
                  fontSize: 12,
                  background: isDark() ? "#2a2925" : "#fff",
                  color: isDark() ? "#f5f4f1" : "#23231f",
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="predicted" name="Predicted °C" fill="#ee6c1f" radius={[4, 4, 0, 0]} />
              <Bar dataKey="measured" name="Measured °C" fill="#1d9e75" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <select className={selectCls} value={sev} onChange={(e) => setSev(e.target.value as AnomalySeverity | "all")}>
          {SEVERITIES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value as AnomalyStatusType | "all")}>
          {STATUSES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <select className={selectCls} value={sort} onChange={(e) => setSort(e.target.value as "newest" | "oldest" | "largest")}>
          <option value="newest">Sort: Newest</option>
          <option value="oldest">Sort: Oldest</option>
          <option value="largest">Sort: Largest Δ</option>
        </select>
        <p className="ml-auto text-[12px] text-ink-400">{filtered.length} anomaly(ies)</p>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {filtered.length > 0 ? (
          filtered.map((a) => {
            const room = roomById(a.roomId);
            return (
              <Link key={a.id} to={`/b/${buildingId}/anomalies/${a.id}`}>
                <Card className="flex items-center justify-between p-4 transition hover:border-primary-300">
                  <div className="flex items-center gap-4">
                    <span className={clsx("h-2.5 w-2.5 shrink-0 rounded-full", severityDot[a.severity])} />
                    <div>
                      <p className="text-[14px] font-medium">{room?.label ?? a.roomId}</p>
                      <p className="text-[12px] text-ink-400">{new Date(a.raisedAt).toLocaleString()}</p>
                      <p className="mt-0.5 text-[12px] text-ink-400">
                        predicted <span className="font-medium text-ink-700 dark:text-ink-200">{a.predictedC}°C</span> vs measured{" "}
                        <span className="font-medium text-ink-700 dark:text-ink-200">{a.measuredC}°C</span> · Δ{" "}
                        <span className={clsx("font-semibold", a.deltaC > 0 ? "text-red-600 dark:text-red-300" : "text-teal-600 dark:text-teal-300")}>
                          {a.deltaC > 0 ? "+" : ""}{a.deltaC}°C
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={a.severity} />
                    <StatusBadge status={a.status} />
                    <ChevronRight size={16} className="text-ink-300" />
                  </div>
                </Card>
              </Link>
            );
          })
        ) : (
          <Card className="p-8 text-center text-[13px] text-ink-400">No anomalies match these filters.</Card>
        )}
      </div>
    </div>
  );
}