import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  Zap,
  Building2,
  Sun,
  Thermometer,
  MoreVertical,
  LayoutDashboard,
  LayoutGrid,
  DoorOpen,
  FileBarChart,
  Settings,
  Trash2,
  Users,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import clsx from "clsx";
import { Card, PrimaryButton, inputClass } from "../components/ui";
import { ApiError, fetchOrgBuildings, toPortfolioBuilding } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { AgentStatusState, Building } from "../types";

const agentStateStyles: Record<AgentStatusState, string> = {
  completed: "text-teal-700 dark:text-teal-300",
  monitoring: "text-primary-600 dark:text-primary-400",
  idle: "text-ink-400",
  warning: "text-red-700 dark:text-red-300",
};
const agentDot: Record<AgentStatusState, string> = {
  completed: "bg-teal-500",
  monitoring: "bg-primary-500",
  idle: "bg-ink-300 dark:bg-ink-600",
  warning: "bg-red-500",
};

const buildingStatus = {
  healthy: { label: "Healthy", dot: "bg-teal-500", text: "text-teal-700 dark:text-teal-300" },
  monitoring: { label: "Monitoring", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" },
  critical: { label: "Critical", dot: "bg-red-500", text: "text-red-700 dark:text-red-300" },
};



function HealthBar({ score }: { score: number }) {
  const color = score >= 85 ? "#1d9e75" : score >= 60 ? "#ef9f27" : "#e24b4a";
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">Building Health</p>
        <p className="text-[14px] font-semibold">{score}%</p>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function QuickActions({ building }: { building: Building }) {
  const [open, setOpen] = useState(false);
  const base = `/b/${building.id}`;
  const items = [
    { to: base, icon: <LayoutDashboard size={14} />, label: "Open dashboard" },
    { to: `${base}/floors/floor-1`, icon: <LayoutGrid size={14} />, label: "Heatmap" },
    { to: `${base}/registry`, icon: <DoorOpen size={14} />, label: "Rooms" },
    { to: `${base}/reports`, icon: <FileBarChart size={14} />, label: "Reports" },
    { to: `${base}/settings`, icon: <Settings size={14} />, label: "Settings" },
  ];
  return (
    <div className="relative">
      <button
        className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-50 hover:text-ink-800 dark:hover:bg-ink-800 dark:hover:text-ink-200"
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        aria-label="Quick actions"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-ink-100 bg-white py-1 shadow-lg dark:border-ink-800 dark:bg-ink-900">
            {items.map((it) => (
              <Link
                key={it.to}
                to={it.to}
                className="flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-ink-700 transition hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800"
              >
                {it.icon}
                {it.label}
              </Link>
            ))}
            <div className="my-1 h-px bg-ink-100 dark:bg-ink-800" />
            <button className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] text-red-700 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950">
              <Trash2 size={14} />
              Delete building
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function BuildingCard({ building }: { building: Building }) {
  const st = buildingStatus[building.status];
  const base = `/b/${building.id}`;
  const offline = building.sensorsTotal - building.sensorsOnline;

  return (
    <Card className="flex flex-col p-5 transition duration-200 hover:-translate-y-1 hover:shadow-lg hover:border-primary-300">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[16px] font-medium">{building.name}</h3>
            <span className={clsx("inline-flex shrink-0 items-center gap-1 text-[12px] font-medium", st.text)}>
              <span className={clsx("h-1.5 w-1.5 rounded-full", st.dot)} /> {st.label}
            </span>
          </div>
          <p className="text-[12px] text-ink-400">{building.address}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="flex items-center gap-1 rounded-full bg-ink-50 px-2 py-0.5 text-[12px] text-ink-600 dark:bg-ink-800 dark:text-ink-300">
            <Thermometer size={12} className="text-primary-500" />
            <span className="font-medium">{building.weather.tempC}°C</span>
          </span>
          <QuickActions building={building} />
        </div>
      </div>

      {/* AI pipeline — explained, not named */}
      <div className="mt-4 rounded-xl bg-ink-50 p-3 dark:bg-ink-800">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-400">
          <Zap size={11} /> AI Pipeline
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {building.agents.map((a) => (
            <div key={a.name} className="flex items-center justify-between gap-2 text-[12px]">
              <span className="truncate text-ink-600">{a.label}</span>
              <span className={clsx("flex shrink-0 items-center gap-1 font-medium", agentStateStyles[a.state])}>
                <span className={clsx("h-1.5 w-1.5 rounded-full", agentDot[a.state])} />
                {a.detail}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <HealthBar score={building.healthScore} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-ink-100 pt-3 text-[12px] dark:border-ink-800">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-ink-600">
          <span>
            Sensors <span className="font-medium text-teal-700 dark:text-teal-300">{building.sensorsOnline} online</span>
            {offline > 0 && <span className="font-medium text-red-700 dark:text-red-300"> · {offline} offline</span>}
          </span>
          <span>
            Energy saved <span className="font-medium text-ink-900 dark:text-ink-100">{building.energySavedPct}%</span>
          </span>
          <span>
            Carbon saved <span className="font-medium text-ink-900 dark:text-ink-100">{building.co2AvoidedTonMonth.toFixed(1)} t</span>
          </span>
        </div>
        <span className={clsx("flex shrink-0 items-center gap-1 font-medium", building.activeAnomalies > 0 ? "text-red-700 dark:text-red-300" : "text-teal-700 dark:text-teal-300")}>
          {building.activeAnomalies} anomaly{building.activeAnomalies === 1 ? "" : "ies"}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-end">
        <Link to={base} className="shrink-0 rounded-xl bg-primary-500 px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-primary-600">
          Open dashboard
        </Link>
      </div>
    </Card>
  );
}

function SummaryCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-white p-4 shadow-sm dark:border-ink-800 dark:bg-ink-900">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[12px] text-ink-400">{label}</p>
        <p className={clsx("truncate text-lg font-medium", accent ?? "text-ink-900 dark:text-ink-100")}>{value}</p>
      </div>
    </div>
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
      energySaved: buildings.reduce((s, b) => s + b.energySavedPct, 0) / Math.max(1, buildings.length),
      carbonSaved: buildings.reduce((s, b) => s + b.co2AvoidedTonMonth, 0),
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

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        <SummaryCard icon={<Building2 size={16} />} label="Buildings" value={String(totals.buildings)} />
        <SummaryCard icon={<Users size={16} />} label="Healthy Rooms" value={String(totals.healthyRooms)} />
        <SummaryCard icon={<Zap size={16} />} label="Active Anomalies" value={String(totals.activeAnomalies)} accent={totals.activeAnomalies > 0 ? "text-red-700 dark:text-red-300" : "text-teal-700 dark:text-teal-300"} />
        <SummaryCard icon={<Zap size={16} />} label="Energy Saved" value={`${totals.energySaved.toFixed(0)}%`} accent="text-teal-700 dark:text-teal-300" />
        <SummaryCard icon={<Sun size={16} />} label="Carbon Saved" value={`${totals.carbonSaved.toFixed(1)} t`} accent="text-teal-700 dark:text-teal-300" />
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