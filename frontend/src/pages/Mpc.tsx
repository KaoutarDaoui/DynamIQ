import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { Play, Pause, RotateCcw, Timer, Zap } from "lucide-react";
import clsx from "clsx";
import { mpcSchedule } from "../data/mock";
import { Card, CardHeader, StatusBadge } from "../components/ui";

function isDark() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

export default function Mpc() {
  const { buildingId = "esi-algiers" } = useParams();
  const [running, setRunning] = useState(true);
  const [horizon, setHorizon] = useState<"6h" | "12h" | "24h">("24h");

  const sliced = mpcSchedule.filter((p) => {
    const idx = Number(p.hour.slice(0, 2));
    return horizon === "6h" ? idx <= 12 : horizon === "12h" ? idx <= 20 : true;
  });

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-medium">MPC schedule</h1>
          <p className="mt-1 text-[13px] text-ink-400">Model predictive control — setpoints planned to minimize cost and carbon.</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={running ? "online" : "offline"} label={running ? "running" : "paused"} />
          <button
            onClick={() => setRunning((v) => !v)}
            className={clsx(
              "flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-medium text-white transition",
              running ? "bg-red-500 hover:bg-red-600" : "bg-teal-600 hover:bg-teal-700"
            )}
          >
            {running ? <Pause size={14} /> : <Play size={14} />}
            {running ? "Pause MPC" : "Start MPC"}
          </button>
        </div>
      </div>

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
            <Zap size={12} className="text-amber-500" /> Objective: min cost + carbon
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-ink-50 px-2.5 py-1 text-[12px] text-ink-600 dark:bg-ink-800 dark:text-ink-300">
            <Timer size={12} className="text-primary-500" /> Next run: 06:00 · Next calibration: 3 h
          </span>
        </div>
        <Link to={`/b/${buildingId}/thermal`} className="ml-auto text-[13px] font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400">
          View thermal models →
        </Link>
      </div>

      {!running && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <span>MPC is paused — rooms will hold their last setpoints until you resume.</span>
          <button onClick={() => setRunning(true)} className="flex items-center gap-1.5 font-medium hover:underline">
            <RotateCcw size={13} /> Resume
          </button>
        </div>
      )}

      <Card className="mt-4">
        <CardHeader title="Planned vs actual setpoint" subtitle={`${horizon} look-ahead`} />
        <div className="h-72 px-2 pb-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sliced} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
              <XAxis dataKey="hour" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8c897d" }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8c897d" }} domain={[18, 28]} />
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
              <Line type="monotone" dataKey="plannedC" name="Planned °C" stroke="#ee6c1f" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="actualC" name="Actual °C" stroke="#1d9e75" strokeWidth={2} dot={false} strokeDasharray="4 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="mt-5">
        <CardHeader title="Carbon intensity & price" subtitle="MPC shifts cooling to low-carbon hours when possible" />
        <div className="h-56 px-2 pb-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mpcSchedule} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
              <XAxis dataKey="hour" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8c897d" }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8c897d" }} width={36} />
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
              <Line type="monotone" dataKey="carbonIntensity" name="gCO₂/kWh" stroke="#1d9e75" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="priceDzdKwh" name="DZD/kWh" stroke="#ee6c1f" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
