import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  Building2,
  Users,
  Loader2,
  AlertTriangle,
  MapPin,
} from "lucide-react";
import clsx from "clsx";
import { Card, PrimaryButton } from "../components/ui";
import { ApiError, fetchOrgBuildings, toPortfolioBuilding } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Building } from "../types";

const buildingStatus = {
  healthy: { label: "Healthy", dot: "bg-teal-500", text: "text-teal-700 dark:text-teal-300" },
  monitoring: { label: "Active", dot: "bg-teal-500", text: "text-teal-700 dark:text-teal-300" },
  critical: { label: "Critical", dot: "bg-red-500", text: "text-red-700 dark:text-red-300" },
};

function SummaryCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:border-primary-300 dark:border-ink-800 dark:bg-ink-900 dark:hover:border-primary-700">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[12px] text-ink-400">{label}</p>
        <p className={clsx("truncate text-lg font-medium", accent ?? "text-ink-900 dark:text-ink-100")}>{value}</p>
      </div>
    </div>
  );
}

function BuildingCard({ building }: { building: Building }) {
  const st = buildingStatus[building.status];
  const base = `/b/${building.id}`;
  
  const anomalyColor = building.activeAnomalies > 0 ? "text-red-700 dark:text-red-300" : "text-teal-700 dark:text-teal-300";

  return (
    <Card className="flex flex-col p-5 transition duration-200 hover:-translate-y-1 hover:shadow-lg hover:border-primary-300">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-[18px] font-semibold">{building.name}</h3>
          <p className="mt-1 text-[13px] text-ink-500 flex items-center gap-1">
            <MapPin size={12} className="text-ink-400" />
            {building.address}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-teal-500" />
            <span className="text-[12px] font-medium text-teal-700 dark:text-teal-300">{st.label}</span>
          </div>
        </div>
        <Link to={base} className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl bg-primary-500 px-4 py-2.5 text-[14px] font-medium text-white transition hover:bg-primary-600 active:bg-primary-700">
          View details
        </Link>
      </div>

      <div className="mt-5 border-t border-ink-100 pt-4 dark:border-ink-800">
        <div className="flex items-center gap-3">
          <span className={clsx("text-[14px] font-medium", anomalyColor)}>
            Anomalies {building.activeAnomalies} active
          </span>
        </div>
      </div>
    </Card>
  );
}

export default function Portfolio() {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { orgId } = useAuth();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchOrgBuildings(orgId ?? undefined)
      .then((dtos) => {
        if (!cancelled) setBuildings(dtos.map(toPortfolioBuilding));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not reach the backend.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const totals = useMemo(
    () => ({
      buildings: buildings.length,
      healthyRooms: buildings.reduce((s, b) => s + (b.roomsCount - b.activeAnomalies), 0),
      activeAnomalies: buildings.reduce((s, b) => s + b.activeAnomalies, 0),
    }),
    [buildings]
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-[22px] font-medium">Building Portfolio</h1>
          <p className="mt-1 text-[13px] text-ink-400">Manage every building monitored by DynamIQ.</p>
        </div>
        <Link to="/onboarding">
          <PrimaryButton>
            <Plus size={16} /> Add Building
          </PrimaryButton>
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
        <SummaryCard icon={<Building2 size={16} />} label="Buildings" value={String(totals.buildings)} />
        <SummaryCard icon={<Users size={16} />} label="Healthy Rooms" value={String(totals.healthyRooms)} />
        <SummaryCard icon={<AlertTriangle size={16} />} label="Active Anomalies" value={String(totals.activeAnomalies)} accent={totals.activeAnomalies > 0 ? "text-red-700 dark:text-red-300" : "text-teal-700 dark:text-teal-300"} />
      </div>

      {loading ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-ink-200 bg-white/50 px-6 text-center dark:border-ink-700 dark:bg-ink-900/50">
          <Loader2 size={28} className="animate-spin text-primary-500" />
          <p className="mt-3 text-[13px] text-ink-400">Loading your portfolio…</p>
        </div>
      ) : error ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-red-200 bg-red-50/50 px-6 text-center dark:border-red-900 dark:bg-red-950/20">
          <AlertTriangle size={28} className="text-red-500" />
          <p className="mt-3 text-[15px] font-medium text-ink-900 dark:text-ink-100">Couldn't load buildings</p>
          <p className="mt-1 max-w-sm text-[13px] text-ink-400">{error}</p>
        </div>
      ) : buildings.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {buildings.map((b) => (
            <BuildingCard key={b.id} building={b} />
          ))}
        </div>
      ) : (
        <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-ink-200 bg-white/50 px-6 text-center dark:border-ink-700 dark:bg-ink-900/50">
          <Building2 size={32} className="text-ink-300 dark:text-ink-600" />
          <p className="mt-3 text-[15px] font-medium text-ink-900 dark:text-ink-100">No buildings found</p>
          <p className="mt-1 max-w-sm text-[13px] text-ink-400">Your portfolio is empty. Upload your next building and let building analysis handle it automatically.</p>
          <Link to="/onboarding" className="mt-5">
            <PrimaryButton>
              <Plus size={16} /> Add Building
            </PrimaryButton>
          </Link>
        </div>
      )}
    </div>
  );
}