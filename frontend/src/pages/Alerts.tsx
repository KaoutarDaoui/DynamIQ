import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, BellOff, ChevronRight, RefreshCw } from "lucide-react";
import { fetchAlerts, ThermalApiError } from "../lib/api";
import type { LiveAlert } from "../types";
import { Card, StatusBadge } from "../components/ui";

export default function Alerts() {
  const { buildingId = "esi-algiers" } = useParams();
  const [alerts, setAlerts] = useState<LiveAlert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchAlerts(buildingId, controller.signal)
      .then(setAlerts)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ThermalApiError ? err.message : "Failed to load alerts");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [buildingId, reloadKey]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-medium">Alerts</h1>
          <p className="mt-1 text-[13px] text-ink-400">Dispatched whenever Agent 4's deterministic decision gate routes a diagnosis to a human — live, not mocked.</p>
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

      {!error && (
        <div className="mt-6 flex flex-col gap-3">
          {loading &&
            Array.from({ length: 2 }).map((_, i) => (
              <Card key={i} className="animate-pulse p-4">
                <div className="h-4 w-48 rounded bg-ink-100 dark:bg-ink-800" />
              </Card>
            ))}

          {!loading && alerts?.length === 0 && (
            <Card className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400">
                <BellOff size={22} />
              </span>
              <p className="mt-4 text-[15px] font-medium">No alerts</p>
              <p className="mt-1 max-w-sm text-[13px] text-ink-400">
                Every diagnosis so far has either been handled autonomously or suppressed by cooldown — nothing has needed a human yet.
              </p>
            </Card>
          )}

          {!loading &&
            alerts?.map((a) => (
              <Link key={a.id} to={`/b/${buildingId}/anomalies/${a.anomalyId}`}>
                <Card className="flex items-center justify-between p-4 transition hover:border-primary-300">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[14px] font-medium">{a.roomLabel}</p>
                      <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium capitalize text-ink-600 dark:bg-ink-800 dark:text-ink-300">{a.channel}</span>
                      <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium capitalize text-ink-600 dark:bg-ink-800 dark:text-ink-300">{a.recipient.replace("_", " ")}</span>
                    </div>
                    <p className="mt-1 truncate text-[13px] text-ink-600 dark:text-ink-300">{a.message}</p>
                    <p className="mt-1 text-[12px] text-ink-400">{new Date(a.sentAt).toLocaleString()} · cause <span className="font-medium text-ink-700 dark:text-ink-200">{a.cause}</span></p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <StatusBadge status={a.causeConfidence === "high" ? "high" : a.causeConfidence === "medium" ? "medium" : "low"} label={a.causeConfidence} />
                    <ChevronRight size={16} className="text-ink-300" />
                  </div>
                </Card>
              </Link>
            ))}
        </div>
      )}
    </div>
  );
}
