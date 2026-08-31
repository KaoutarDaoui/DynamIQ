import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Layers,
  Gauge,
  Activity,
  Timer,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { fetchThermalModels, ThermalApiError } from "../lib/api";
import type { ThermalModelRoom } from "../types";
import {
  Card,
  CardHeader,
  StatusBadge,
  SecondaryButton,
} from "../components/ui";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export default function Thermal() {
  const { buildingId = "esi-algiers" } = useParams();
  const [rooms, setRooms] = useState<ThermalModelRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchThermalModels(buildingId, controller.signal)
      .then(setRooms)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          err instanceof ThermalApiError
            ? err.message
            : "Failed to load thermal models",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [buildingId, reloadKey]);

  // The sensor feed writes a new reading per room every 2 minutes; poll on
  // the same cadence so room parameters reflect it without a manual refresh.
  useEffect(() => {
    const id = window.setInterval(() => setReloadKey((k) => k + 1), 120_000);
    return () => window.clearInterval(id);
  }, []);

  const calibrated = useMemo(
    () => (rooms ?? []).filter((r) => r.isCalibrated),
    [rooms],
  );
  const avgR = useMemo(
    () =>
      calibrated.length
        ? calibrated.reduce((s, r) => s + (r.rLumpedKPerW ?? 0), 0) /
          calibrated.length
        : null,
    [calibrated],
  );
  const avgRmse = useMemo(
    () =>
      calibrated.length
        ? calibrated.reduce((s, r) => s + (r.rmseValidationC ?? 0), 0) /
          calibrated.length
        : null,
    [calibrated],
  );
  const lastCalibratedAt = useMemo(() => {
    const timestamps = calibrated
      .map((r) => r.calibratedAt)
      .filter((t): t is string => t !== null);
    return timestamps.length ? timestamps.sort().at(-1)! : null;
  }, [calibrated]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-medium">Thermal models</h1>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <SecondaryButton onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw size={14} /> Refresh
          </SecondaryButton>
          <span className="text-[11px] text-ink-400">
            Auto-refreshes every 2 min
          </span>
        </div>
      </div>

      {error && (
        <Card className="mt-6 border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
          <p className="flex items-center gap-2 text-[13px] font-medium text-red-700 dark:text-red-300">
            <AlertTriangle size={15} /> {error}
          </p>
          <p className="mt-1 text-[12px] text-red-700/80 dark:text-red-300/70">
            Start the Thermal Agent API with{" "}
            <code className="rounded bg-red-500/10 px-1 py-0.5">
              uvicorn agents.thermal_agent.api:app --port 8001
            </code>{" "}
            from the repo root, then retry.
          </p>
        </Card>
      )}

      {!error && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card className="p-4">
              <p className="flex items-center gap-1.5 text-[12px] text-ink-400">
                <Layers size={13} /> Rooms modeled
              </p>
              <p className="mt-1 text-xl font-medium">
                {loading ? "—" : (rooms?.length ?? 0)}
              </p>
            </Card>
            <Card className="p-4">
              <p className="flex items-center gap-1.5 text-[12px] text-ink-400">
                <CheckCircle2 size={13} /> Calibrated
              </p>
              <p className="mt-1 text-xl font-medium">
                {loading ? "—" : `${calibrated.length} / ${rooms?.length ?? 0}`}
              </p>
            </Card>
            <Card className="p-4">
              <p className="flex items-center gap-1.5 text-[12px] text-ink-400">
                <Gauge size={13} /> Avg R (lumped)
              </p>
              <p className="mt-1 text-xl font-medium">
                {avgR !== null ? `${avgR.toFixed(4)} K/W` : "—"}
              </p>
            </Card>
            <Card className="p-4">
              <p className="flex items-center gap-1.5 text-[12px] text-ink-400">
                <Activity size={13} /> Avg validation RMSE
              </p>
              <p className="mt-1 text-xl font-medium">
                {avgRmse !== null ? `${avgRmse.toFixed(2)} °C` : "—"}
              </p>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader
              title="Room parameters"
              subtitle={
                lastCalibratedAt
                  ? `Lumped R/C fitted from sensor history · most recent calibration ${relativeTime(lastCalibratedAt)}`
                  : "Lumped R/C fitted from sensor history"
              }
            />
            <div className="flex flex-col divide-y divide-ink-100 dark:divide-ink-800">
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="animate-pulse px-5 py-3">
                    <div className="h-4 w-40 rounded bg-ink-100 dark:bg-ink-800" />
                  </div>
                ))}

              {!loading && rooms?.length === 0 && (
                <p className="px-5 py-6 text-[13px] text-ink-400">
                  No rooms found for this building.
                </p>
              )}

              {!loading &&
                rooms?.map((r) => (
                  <div
                    key={r.roomId}
                    className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium">{r.roomLabel}</p>
                      <p className="text-[12px] text-ink-400">
                        Floor {r.floorLevel} · {r.areaM2} m²
                        {!r.isInstrumented && " · no sensor"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-[13px]">
                      <div className="text-right">
                        <p className="text-[11px] uppercase tracking-wide text-ink-400">
                          R (lumped)
                        </p>
                        <p className="font-medium">
                          {r.rLumpedKPerW !== null
                            ? `${r.rLumpedKPerW.toFixed(4)} K/W`
                            : "—"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] uppercase tracking-wide text-ink-400">
                          C (zone)
                        </p>
                        <p className="font-medium">
                          {r.cLumpedJPerK !== null
                            ? `${(r.cLumpedJPerK / 1000).toFixed(0)}k J/K`
                            : "—"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] uppercase tracking-wide text-ink-400">
                          Validation RMSE
                        </p>
                        <p className="font-medium">
                          {r.rmseValidationC !== null
                            ? `${r.rmseValidationC.toFixed(2)} °C`
                            : "—"}
                        </p>
                      </div>
                      {r.isCalibrated ? (
                        <span className="flex items-center gap-1 text-[12px] font-medium text-teal-700 dark:text-teal-300">
                          <CheckCircle2 size={13} />
                          {r.calibratedAt ? relativeTime(r.calibratedAt) : ""}
                        </span>
                      ) : (
                        <span className="text-[12px] font-medium text-ink-400">
                          Awaiting calibration
                        </span>
                      )}
                      <StatusBadge
                        status={r.isInstrumented ? "online" : "offline"}
                        label={r.isInstrumented ? "instrumented" : "no sensor"}
                      />
                    </div>
                  </div>
                ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
