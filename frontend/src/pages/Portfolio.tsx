import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Zap,
  Building2,
  MoreVertical,
  LayoutDashboard,
  LayoutGrid,
  DoorOpen,
  FileBarChart,
  Settings,
  Trash2,
  Users,
  AlertTriangle,
  Leaf,
  Activity,
  ChevronRight,
} from "lucide-react";
import clsx from "clsx";
import { buildings, currentUser } from "../data/mock";
import { Card, PrimaryButton } from "../components/ui";
import type { Building } from "../types";

const buildingStatus = {
  healthy: { label: "Healthy", dot: "bg-teal-500", text: "text-teal-700 dark:text-teal-300" },
  monitoring: { label: "Monitoring", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" },
  critical: { label: "Critical", dot: "bg-red-500", text: "text-red-700 dark:text-red-300" },
};

type StatusFilter = "all" | Building["status"];

const statusFilters: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "healthy", label: "Healthy" },
  { id: "monitoring", label: "Monitoring" },
  { id: "critical", label: "Critical" },
];

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
          e.stopPropagation();
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
  const navigate = useNavigate();
  const healthColor = building.healthScore >= 85 ? "#1d9e75" : building.healthScore >= 60 ? "#ef9f27" : "#e24b4a";

  return (
    <Card
      className="group cursor-pointer p-5 transition duration-200 hover:-translate-y-1 hover:shadow-lg hover:border-primary-300"
    >
      <div onClick={() => navigate(base)}>
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[16px] font-medium">{building.name}</h3>
              <span className={clsx("inline-flex shrink-0 items-center gap-1 text-[12px] font-medium", st.text)}>
                <span className={clsx("h-1.5 w-1.5 rounded-full", st.dot)} /> {st.label}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-ink-400">{building.address}</p>
          </div>
          <QuickActions building={building} />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span className="text-2xl font-medium">{building.healthScore}%</span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-400">Health</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
            <div className="h-full rounded-full rounded transition-all duration-700" style={{ width: `${building.healthScore}%`, backgroundColor: healthColor }} />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-ink-100 pt-3 dark:border-ink-800">
          <span className={clsx("flex items-center gap-1 text-[13px] font-medium", building.activeAnomalies > 0 ? "text-red-700 dark:text-red-300" : "text-teal-700 dark:text-teal-300")}>
            {building.activeAnomalies > 0 && <AlertTriangle size={14} />}
            {building.activeAnomalies} active anomaly{building.activeAnomalies === 1 ? "" : "ies"}
          </span>
          <span className="flex items-center gap-1 text-[13px] font-medium text-primary-600 transition group-hover:gap-1.5 dark:text-primary-400">
            View dashboard <ChevronRight size={15} />
          </span>
        </div>
      </div>
    </Card>
  );
}

function SummaryCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-white p-5 shadow-sm dark:border-ink-800 dark:bg-ink-900">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium tracking-wide text-ink-400">{label}</p>
        <p className={clsx("truncate text-3xl font-semibold", accent ?? "text-ink-900 dark:text-ink-100")}>{value}</p>
      </div>
    </div>
  );
}

export default function Portfolio() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const totals = useMemo(
    () => ({
      buildings: buildings.length,
      healthyRooms: buildings.reduce((s, b) => s + (b.roomsCount - b.activeAnomalies), 0),
      activeAnomalies: buildings.reduce((s, b) => s + b.activeAnomalies, 0),
      sensorsOnline: buildings.reduce((s, b) => s + b.sensorsOnline, 0),
      sensorsTotal: buildings.reduce((s, b) => s + b.sensorsTotal, 0),
      energySaved: buildings.reduce((s, b) => s + b.energySavedPct, 0) / Math.max(1, buildings.length),
      carbonSaved: buildings.reduce((s, b) => s + b.co2AvoidedTonMonth, 0),
    }),
    []
  );

  const filtered = useMemo(
    () => buildings.filter((b) => statusFilter === "all" || b.status === statusFilter),
    [statusFilter]
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] text-ink-400">Good morning, {currentUser.name.split(" ")[0]}</p>
          <h1 className="text-[22px] font-medium">My Buildings</h1>
          <p className="mt-1 text-[13px] text-ink-400">
            You manage {totals.buildings} {totals.buildings === 1 ? "building" : "buildings"}, {totals.activeAnomalies} active{" "}
            {totals.activeAnomalies === 1 ? "alert" : "alerts"}.
          </p>
        </div>
        <Link to="/onboarding">
          <PrimaryButton>
            <Plus size={16} /> Add Building
          </PrimaryButton>
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryCard icon={<Building2 size={16} />} label="Buildings" value={String(totals.buildings)} />
        <SummaryCard icon={<Users size={16} />} label="Healthy Rooms" value={String(totals.healthyRooms)} />
        <SummaryCard
          icon={<AlertTriangle size={16} />}
          label="Active Anomalies"
          value={String(totals.activeAnomalies)}
          accent={totals.activeAnomalies > 0 ? "text-red-700 dark:text-red-300" : "text-teal-700 dark:text-teal-300"}
        />
        <SummaryCard
          icon={<Zap size={16} />}
          label="Energy Saved"
          value={`${totals.energySaved.toFixed(0)}%`}
          accent="text-amber-700 dark:text-amber-300"
        />
        <SummaryCard icon={<Leaf size={16} />} label="CO₂ Avoided" value={`${totals.carbonSaved.toFixed(1)} t`} accent="text-teal-700 dark:text-teal-300" />
        <SummaryCard
          icon={<Activity size={16} />}
          label="Sensors Online"
          value={`${totals.sensorsOnline}/${totals.sensorsTotal}`}
          accent="text-primary-700 dark:text-primary-300"
        />
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {statusFilters.map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={clsx(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition",
                statusFilter === f.id
                  ? "border-primary-500 bg-primary-500 text-white"
                  : "border-ink-200 bg-white text-ink-600 hover:border-primary-300 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300"
              )}
            >
              {f.id !== "all" && <span className={clsx("h-1.5 w-1.5 rounded-full", buildingStatus[f.id].dot)} />}
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {filtered.map((b) => (
            <BuildingCard key={b.id} building={b} />
          ))}
        </div>
      ) : (
        <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-ink-200 bg-white/50 px-6 text-center dark:border-ink-700 dark:bg-ink-900/50">
          <Building2 size={32} className="text-ink-300 dark:text-ink-600" />
          <p className="mt-3 text-[15px] font-medium text-ink-900 dark:text-ink-100">No buildings found</p>
          <p className="mt-1 max-w-sm text-[13px] text-ink-400">
            {statusFilter !== "all"
              ? "No buildings match this filter."
              : "You have no buildings yet. Add your first one and let building analysis handle it automatically."}
          </p>
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
