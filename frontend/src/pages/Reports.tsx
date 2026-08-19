import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import { fetchOrgBuildings, fetchReportsSummary, ThermalApiError } from "../lib/api";
import { exportReportsPdf } from "../lib/pdf";
import type { ReportsSummary } from "../types";
import { Card, CardHeader, PrimaryButton, StatCard } from "../components/ui";

function isDark() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

export default function Reports() {
  const { buildingId = "djezzy-hq" } = useParams();
  const [summary, setSummary] = useState<ReportsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [buildingLabel, setBuildingLabel] = useState<string>(buildingId);

  useEffect(() => {
    let active = true;
    fetchOrgBuildings()
      .then((bs) => {
        const b = bs.find((x) => x.building_id === buildingId);
        if (b && active) setBuildingLabel(b.name);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [buildingId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchReportsSummary(buildingId, 30, controller.signal)
      .then(setSummary)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ThermalApiError ? err.message : "Failed to load reports");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [buildingId, reloadKey]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-medium">Reports</h1>
          <p className="mt-1 text-[13px] text-ink-400">Predicted energy, carbon and comfort tracking from Agent 2's real MPC solves — live, not mocked.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="flex items-center gap-1.5 rounded-xl border border-ink-200 px-3.5 py-2 text-[13px] font-medium text-ink-700 transition hover:bg-ink-50 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <PrimaryButton onClick={() => summary && exportReportsPdf(summary, buildingLabel)} className={!summary ? "pointer-events-none opacity-50" : undefined}>
            <Download size={14} /> Export PDF
          </PrimaryButton>
        </div>
      </div>

      {error && (
        <Card className="mt-6 border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
          <p className="flex items-center gap-2 text-[13px] font-medium text-red-700 dark:text-red-300">
            <AlertTriangle size={15} /> {error}
          </p>
        </Card>
      )}

      {!error && loading && (
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="animate-pulse p-5">
              <div className="h-4 w-24 rounded bg-ink-100 dark:bg-ink-800" />
            </Card>
          ))}
        </div>
      )}

      {!error && !loading && summary && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label={`Predicted energy (${summary.windowDays}d)`} value={`${summary.totalPredictedKwh.toFixed(1)} kWh`} />
            <StatCard label={`Predicted CO2 (${summary.windowDays}d)`} value={`${(summary.totalPredictedGco2 / 1000).toFixed(1)} kg`} />
            <StatCard label={`Predicted cost (${summary.windowDays}d)`} value={`${summary.totalPredictedCostCurrency.toFixed(0)} DZD`} />
            <StatCard
              label="Avg comfort deviation"
              value={summary.avgComfortDeviationC !== null ? `${summary.avgComfortDeviationC.toFixed(1)}°C` : "—"}
            />
          </div>
          <p className="mt-2 text-[12px] text-ink-400">
            These are the MPC's own predicted totals from real <code>mpc_schedules</code> rows — there is no reactive-baseline counterfactual stored anywhere in the system, so "energy saved" isn't a number DynamIQ can honestly report yet.
          </p>

          <Card className="mt-5">
            <CardHeader title="Predicted energy & carbon by day" subtitle={`Sum of Agent 2's planned setpoint trajectories, last ${summary.windowDays} days`} />
            <div className="h-64 px-2 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.daily} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={isDark() ? "#3a392f" : "#e8e7e3"} />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8c897d" }} />
                  <YAxis yAxisId="kwh" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#8c897d" }} width={40} />
                  <YAxis yAxisId="gco2" orientation="right" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#8c897d" }} width={50} />
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
                  <Bar yAxisId="kwh" dataKey="kwh" fill="#ee6c1f" radius={[6, 6, 0, 0]} name="kWh" isAnimationActive={false} />
                  <Bar yAxisId="gco2" dataKey="gco2" fill="#1d9e75" radius={[6, 6, 0, 0]} name="gCO₂" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="mt-5">
            <CardHeader title="Comfort tracking" subtitle="Instrumented rooms ranked by distance from the comfort band midpoint (23°C), from their latest real reading" />
            <div className="divide-y divide-ink-100 dark:divide-ink-800">
              {summary.comfortLeaderboard.length === 0 && (
                <p className="px-5 py-6 text-center text-[13px] text-ink-400">No instrumented rooms with sensor readings yet.</p>
              )}
              {summary.comfortLeaderboard.map((r, i) => (
                <div key={r.roomId} className="flex items-center justify-between px-5 py-3 text-[14px]">
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-50 text-[12px] font-medium text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">{i + 1}</span>
                    <span className="font-medium">{r.roomLabel}</span>
                    <span className="text-[12px] text-ink-400">Floor {r.floorLevel}</span>
                  </div>
                  <span className="text-[12px] text-ink-600 dark:text-ink-300">
                    {r.latestTempC.toFixed(1)}°C · Δ {r.deviationC.toFixed(1)}°C from band · {new Date(r.readingAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
