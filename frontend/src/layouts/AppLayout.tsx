import { useEffect, useMemo, useState } from "react";
import { NavLink, Link, Outlet, useNavigate, useParams } from "react-router-dom";
import {
  Zap,
  Search,
  Sun,
  Moon,
  Bell,
  ChevronRight,
  ChevronDown,
  LayoutDashboard,
  Building2,
  LayoutGrid,
  DoorOpen,
  Cpu,
  AlertTriangle,
  BellRing,
  Wrench,
  FileBarChart,
  Settings,
  HelpCircle,
  Activity,
  LogOut,
  Play,
  Pause,
  Timer,
} from "lucide-react";
import clsx from "clsx";
import { currentUser, notifications, globalAgents, buildings, floors, rooms } from "../data/mock";
import type { AgentStatusState } from "../types";

const agentDot: Record<AgentStatusState, string> = {
  completed: "bg-teal-500",
  monitoring: "bg-primary-500",
  idle: "bg-ink-300 dark:bg-ink-600",
  warning: "bg-red-500",
};
const agentText: Record<AgentStatusState, string> = {
  completed: "text-teal-700 dark:text-teal-400",
  monitoring: "text-primary-600 dark:text-primary-400",
  idle: "text-ink-400",
  warning: "text-red-700 dark:text-red-400",
};

function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem("dynamiq-theme") === "dark");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dynamiq-theme", dark ? "dark" : "light");
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

function SearchInput() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const b = buildings.filter((x) => x.name.toLowerCase().includes(term)).map((x) => ({ to: `/b/${x.id}`, label: x.name, sub: "Building" }));
    const f = floors.filter((x) => x.label.toLowerCase().includes(term)).map((x) => ({ to: `/b/${x.buildingId}/floors/${x.id}`, label: x.label, sub: "Floor" }));
    const r = rooms.filter((x) => x.label.toLowerCase().includes(term) || x.hvac.unitId.toLowerCase().includes(term)).map((x) => ({ to: `/b/${"esi-algiers"}/rooms/${x.id}`, label: x.label, sub: x.hvac.unitId }));
    return [...b, ...f, ...r].slice(0, 8);
  }, [q]);

  return (
    <div className="relative mx-2 hidden flex-1 max-w-md md:block">
      <div className="flex items-center gap-2 rounded-lg bg-ink-50 px-3 py-2 dark:bg-ink-800">
        <Search size={15} className="shrink-0 text-ink-400" />
        <input
          className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-400 dark:text-ink-100"
          placeholder="Search buildings, rooms, floors…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && q.trim() && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 z-30 mt-1.5 overflow-hidden rounded-xl border border-ink-100 bg-white py-1 shadow-lg dark:border-ink-800 dark:bg-ink-900">
            {results.length === 0 && <p className="px-3.5 py-3 text-[13px] text-ink-400">No results for "{q}"</p>}
            {results.map((r) => (
              <Link
                key={`${r.sub}-${r.label}`}
                to={r.to}
                onClick={() => {
                  setOpen(false);
                  setQ("");
                }}
                className="flex items-center justify-between px-3.5 py-2 text-[13px] hover:bg-ink-50 dark:hover:bg-ink-800"
              >
                <span className="font-medium text-ink-800 dark:text-ink-100">{r.label}</span>
                <span className="text-[11px] uppercase text-ink-400">{r.sub}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
      >
        <Bell size={18} />
        <span className="absolute right-1.5 top-1.5 flex h-2 w-2 rounded-full bg-red-500" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-xl border border-ink-100 bg-white shadow-lg dark:border-ink-800 dark:bg-ink-900">
            <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3 dark:border-ink-800">
              <p className="text-[14px] font-medium dark:text-white">Notifications</p>
              <span className="rounded-full bg-primary-500/10 px-2 py-0.5 text-[11px] font-medium text-primary-700">
                {notifications.length} new
              </span>
            </div>
            <div className="divide-y divide-ink-100 dark:divide-ink-800">
              {notifications.map((n) => (
                <div key={n.id} className="px-4 py-3">
                  <p className="text-[13px] font-medium text-ink-900 dark:text-ink-50">{n.title}</p>
                  <p className="text-[12px] text-ink-400">{n.time}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AiStatusDropdown() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        className="flex items-center gap-1.5 rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1.5 text-[12px] font-medium text-teal-700 transition hover:bg-teal-500/20 dark:text-teal-400"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
        AI Services Online
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-xl border border-ink-100 bg-white shadow-lg dark:border-ink-800 dark:bg-ink-900">
            <div className="border-b border-ink-100 px-4 py-3 dark:border-ink-800">
              <p className="text-[13px] font-medium dark:text-white">AI Pipeline</p>
              <p className="text-[11px] text-ink-400">Global agent status</p>
            </div>
            <div className="flex flex-col gap-1 p-2">
              {globalAgents.map((a) => (
                <div key={a.name} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-[12px] hover:bg-ink-50 dark:hover:bg-ink-800">
                  <span className="text-ink-600 dark:text-ink-300">{a.label}</span>
                  <span className={clsx("flex items-center gap-1 font-medium", agentText[a.state])}>
                    <span className={clsx("h-1.5 w-1.5 rounded-full", agentDot[a.state])} />
                    {a.detail}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function BuildingSwitcher() {
  const { buildingId } = useParams();
  const [open, setOpen] = useState(false);
  const current = buildings.find((b) => b.id === buildingId);

  return (
    <div className="relative">
      <button
        className="flex items-center gap-2 rounded-xl border border-ink-100 bg-ink-50 px-3 py-2 text-[13px] font-medium text-ink-800 transition hover:border-primary-300 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100"
        onClick={() => setOpen((v) => !v)}
      >
        <Building2 size={15} className="shrink-0 text-primary-500" />
        <span className="truncate">{current ? current.name : "Select building"}</span>
        <ChevronDown size={14} className="shrink-0 text-ink-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-30 mt-2 w-56 overflow-hidden rounded-xl border border-ink-100 bg-white py-1 shadow-lg dark:border-ink-800 dark:bg-ink-900">
            <Link
              to="/"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3.5 py-2 text-[13px] font-medium text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800"
            >
              <LayoutGrid size={15} /> All buildings
            </Link>
            <div className="my-1 h-px bg-ink-100 dark:bg-ink-800" />
            {buildings.map((b) => (
              <Link
                key={b.id}
                to={`/b/${b.id}`}
                onClick={() => setOpen(false)}
                className={clsx(
                  "flex items-center gap-2.5 px-3.5 py-2 text-[13px] hover:bg-ink-50 dark:hover:bg-ink-800",
                  b.id === buildingId ? "bg-primary-500/10 font-medium text-primary-700" : "text-ink-700 dark:text-ink-200"
                )}
              >
                <Building2 size={15} /> {b.name}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SidebarProfile({ dark, toggle, collapsed }: { dark: boolean; toggle: () => void; collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <div className="relative mt-auto border-t border-ink-100 p-2 dark:border-ink-800">
      <div
        className={clsx("flex items-center gap-2 rounded-xl p-1.5 transition hover:bg-ink-50 dark:hover:bg-ink-800", collapsed && "justify-center")}
      >
        <button className="flex min-w-0 items-center gap-2" onClick={() => setOpen((v) => !v)} aria-label="Open profile menu">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[13px] font-medium text-primary-700 dark:bg-primary-800 dark:text-primary-200">
            {currentUser.avatarInitials}
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-[12px] font-medium leading-tight text-ink-900 dark:text-ink-50">{currentUser.name}</p>
              <p className="truncate text-[11px] capitalize leading-tight text-ink-400">{currentUser.role.replace("_", " ")}</p>
            </div>
          )}
        </button>
        <button
          className="shrink-0 rounded-lg p-1.5 text-ink-500 transition hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800"
          onClick={toggle}
          aria-label="Toggle theme"
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-30 mb-1 w-44 overflow-hidden rounded-xl border border-ink-100 bg-white py-1 shadow-lg dark:border-ink-800 dark:bg-ink-900">
            <button
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800"
              onClick={() => {
                setOpen(false);
                navigate(`/b/esi-algiers/settings`);
              }}
            >
              <Settings size={15} /> Profile & settings
            </button>
            <button
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
              onClick={() => {
                setOpen(false);
                navigate("/login");
              }}
            >
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Sidebar({ collapsed }: { collapsed: boolean }) {
  const { buildingId } = useParams();
  const base = buildingId ? `/b/${buildingId}` : null;

  const globalItems = [
    { to: "/", icon: <Building2 size={18} />, label: "My Buildings" },
    { to: "/help", icon: <HelpCircle size={18} />, label: "Help" },
  ];

  const buildingGroups: { title?: string; items: { to: string; icon: React.ReactNode; label: string }[] }[] = base
    ? [
        {
          items: [
            { to: base, icon: <LayoutDashboard size={18} />, label: "Dashboard" },
            { to: `${base}/floors/floor-1`, icon: <LayoutGrid size={18} />, label: "Heatmap" },
            { to: `${base}/registry`, icon: <DoorOpen size={18} />, label: "All rooms" },
          ],
        },
        {
          title: "AI Center",
          items: [
            { to: `${base}/thermal`, icon: <Cpu size={18} />, label: "Thermal models" },
            { to: `${base}/mpc`, icon: <Cpu size={18} />, label: "MPC optimizer" },
            { to: `${base}/anomalies`, icon: <AlertTriangle size={18} />, label: "Anomalies" },
            { to: `${base}/diagnoses`, icon: <Activity size={18} />, label: "Diagnoses" },
          ],
        },
        {
          items: [
            { to: `${base}/alerts`, icon: <BellRing size={18} />, label: "Alerts" },
            { to: `${base}/maintenance`, icon: <Wrench size={18} />, label: "Maintenance" },
            { to: `${base}/reports`, icon: <FileBarChart size={18} />, label: "Reports" },
          ],
        },
        {
          items: [
            { to: `${base}/settings`, icon: <Settings size={18} />, label: "Settings" },
            { to: `${base}/admin`, icon: <Settings size={18} />, label: "Administration" },
          ],
        },
      ]
    : [];

  return (
    <nav className="flex flex-1 flex-col gap-2 overflow-y-auto px-2">
      <div className="flex flex-col gap-0.5">
        {globalItems.map((it) => (
          <NavLink
            key={it.label}
            to={it.to}
            end={it.to === "/"}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium transition",
                isActive ? "bg-primary-500 text-white" : "text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800"
              )
            }
            title={collapsed ? it.label : undefined}
          >
            {it.icon}
            {!collapsed && <span className="truncate">{it.label}</span>}
          </NavLink>
        ))}
      </div>

      {!base ? (
        <div className="mt-3 rounded-lg border border-dashed border-ink-200 p-3 text-[12px] text-ink-400 dark:border-ink-700">
          {!collapsed && "Select a building from the list to access its tools."}
        </div>
      ) : (
        buildingGroups.map((g, gi) => (
          <div key={gi}>
            {g.title && (
              <p className={clsx("px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-400", collapsed && "hidden")}>
                {g.title}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {g.items.map((it) => (
                <NavLink
                  key={it.label}
                  to={it.to}
                  end={it.to === base}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium transition",
                      isActive
                        ? "bg-primary-500 text-white"
                        : "text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800"
                    )
                  }
                  title={collapsed ? it.label : undefined}
                >
                  {it.icon}
                  {!collapsed && <span className="truncate">{it.label}</span>}
                </NavLink>
              ))}
            </div>
          </div>
        ))
      )}
    </nav>
  );
}

export default function AppLayout() {
  const { dark, toggle } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const { buildingId } = useParams();
  const [mpcRunning, setMpcRunning] = useState(true);

  return (
    <div className="flex h-screen overflow-hidden bg-[#f5f4f1] dark:bg-[#161512]">
      <aside
        className={clsx(
          "flex shrink-0 flex-col border-r border-ink-100 bg-white transition-[width] dark:border-ink-800 dark:bg-ink-950 dark:bg-[#1b1a17]",
          collapsed ? "w-[68px]" : "w-60"
        )}
      >
        <div className={clsx("flex items-center gap-2 px-3 pt-3.5 pb-4", collapsed && "justify-center")}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-500 text-white">
            <Zap size={18} />
          </span>
          {!collapsed && <span className="text-[16px] font-medium dark:text-white">DynamIQ</span>}
        </div>
        <Sidebar collapsed={collapsed} />
        <SidebarProfile dark={dark} toggle={toggle} collapsed={collapsed} />
        <button
          className="m-2 flex items-center justify-center gap-2 rounded-lg border border-ink-100 py-1.5 text-[12px] text-ink-400 hover:bg-ink-50 dark:border-ink-800 dark:hover:bg-ink-800"
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? <ChevronRight size={14} /> : <>Collapse</>}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-ink-100 bg-white px-4 dark:border-ink-800 dark:bg-[#1b1a17]">
          <div className="flex min-w-0 items-center gap-2">
            <BuildingSwitcher />
          </div>

          <SearchInput />

          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 rounded-lg px-2 text-[12px] text-ink-500 dark:text-ink-300">
              <Sun size={15} className="text-amber-500" /> 36°C
            </span>
            <AiStatusDropdown />
            <NotificationBell />
          </div>
        </header>

        {buildingId && (
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-ink-100 bg-ink-50/60 px-4 py-2 text-[12px] dark:border-ink-800 dark:bg-ink-800/30">
            <span className="flex items-center gap-1.5 font-medium text-ink-700 dark:text-ink-200">
              <Zap size={13} className="text-primary-500" /> Optimization
            </span>
            <span
              className={clsx(
                "flex items-center gap-1.5",
                mpcRunning ? "text-teal-700 dark:text-teal-300" : "text-ink-400"
              )}
            >
              <span className={clsx("h-1.5 w-1.5 rounded-full", mpcRunning ? "bg-teal-500" : "bg-ink-300")} />
              MPC {mpcRunning ? "active" : "paused"}
            </span>
            <span className="flex items-center gap-1.5 text-ink-500 dark:text-ink-300">
              <Timer size={12} /> Next calibration in 3 h · Last run 06:00
            </span>
            <button
              onClick={() => setMpcRunning((v) => !v)}
              className={clsx(
                "ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition",
                mpcRunning
                  ? "bg-white text-red-600 hover:bg-red-50 dark:bg-ink-900 dark:hover:bg-red-950"
                  : "bg-white text-teal-600 hover:bg-teal-50 dark:bg-ink-900 dark:hover:bg-teal-950"
              )}
            >
              {mpcRunning ? <Pause size={13} /> : <Play size={13} />}
              {mpcRunning ? "Pause MPC" : "Start MPC"}
            </button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto app-scroll p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}