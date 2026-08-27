import { useEffect, useMemo, useState } from "react";
import {
  NavLink,
  Link,
  Outlet,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
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
  FileBarChart,
  Settings,
  HelpCircle,
  Activity,
  LogOut,
  Timer,
  Cpu as CpuIcon,
} from "lucide-react";
import clsx from "clsx";
import { buildings as mockBuildings } from "../data/mock";
import { fetchOrgBuildings, toPortfolioBuilding, fetchThermalModels, fetchMpcRooms, fetchAlerts, ThermalApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Building, ThermalModelRoom, MpcRoomSummary, LiveAlert } from "../types";

function useTheme() {
  const [dark, setDark] = useState(
    () => localStorage.getItem("dynamiq-theme") === "dark",
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dynamiq-theme", dark ? "dark" : "light");
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

function SearchInput({ buildings }: { buildings: Building[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const b = buildings
      .filter((x) => x.name.toLowerCase().includes(term))
      .map((x) => ({ to: `/b/${x.id}`, label: x.name, sub: "Building" }));
    return b.slice(0, 8);
  }, [q, buildings]);

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
            {results.length === 0 && (
              <p className="px-3.5 py-3 text-[13px] text-ink-400">
                No results for "{q}"
              </p>
            )}
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
                <span className="font-medium text-ink-800 dark:text-ink-100">
                  {r.label}
                </span>
                <span className="text-[11px] uppercase text-ink-400">
                  {r.sub}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function NotificationBell({ buildingId }: { buildingId: string | undefined }) {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!buildingId) {
      setAlerts([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchAlerts(buildingId)
      .then((data) => {
        if (!cancelled) {
          setAlerts(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAlerts([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [buildingId]);

  const unreadCount = alerts.length;

  return (
    <div className="relative">
      <button
        className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-2 w-2 rounded-full bg-red-500" />
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-xl border border-ink-100 bg-white shadow-lg dark:border-ink-800 dark:bg-ink-900">
            <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3 dark:border-ink-800">
              <p className="text-[14px] font-medium dark:text-white">
                Alerts
              </p>
              <span className="rounded-full bg-primary-500/10 px-2 py-0.5 text-[11px] font-medium text-primary-700">
                {unreadCount} {unreadCount === 1 ? "alert" : "alerts"}
              </span>
            </div>
            <div className="divide-y divide-ink-100 dark:divide-ink-800 max-h-[400px] overflow-y-auto">
              {loading ? (
                <div className="px-4 py-6 text-center text-[13px] text-ink-400">Loading…</div>
              ) : alerts.length === 0 ? (
                <div className="px-4 py-6 text-center text-[13px] text-ink-400">No alerts</div>
              ) : (
                alerts.map((a) => (
                  <div key={a.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-ink-900 dark:text-ink-50 truncate">
                          {a.roomLabel} · {a.cause}
                        </p>
                        <p className="text-[12px] text-ink-400 truncate">{a.message}</p>
                      </div>
                      <span className="text-[11px] text-ink-400 shrink-0">{formatTimeAgo(a.sentAt)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-400">
                      <span className="flex items-center gap-1 rounded-full bg-ink-50 px-2 py-0.5 dark:bg-ink-800">
                        <span className="font-medium">{a.causeConfidence}</span>
                      </span>
                      <span className="flex items-center gap-1 rounded-full bg-ink-50 px-2 py-0.5 dark:bg-ink-800">
                        {a.channel}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function BuildingSwitcher({ buildings }: { buildings: Building[] }) {
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
        <span className="truncate">
          {current ? current.name : "Select building"}
        </span>
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
                  b.id === buildingId
                    ? "bg-primary-500/10 font-medium text-primary-700"
                    : "text-ink-700 dark:text-ink-200",
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

function SidebarProfile({
  dark,
  toggle,
  collapsed,
}: {
  dark: boolean;
  toggle: () => void;
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  return (
    <div className="relative mt-auto border-t border-ink-100 p-2 dark:border-ink-800">
      <div
        className={clsx(
          "flex items-center gap-2 rounded-xl p-1.5 transition hover:bg-ink-50 dark:hover:bg-ink-800",
          collapsed && "justify-center",
        )}
      >
        <button
          className="flex min-w-0 items-center gap-2"
          onClick={() => setOpen((v) => !v)}
          aria-label="Open profile menu"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[13px] font-medium text-primary-700 dark:bg-primary-800 dark:text-primary-200">
            {user?.avatarInitials}
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-[12px] font-medium leading-tight text-ink-900 dark:text-ink-50">
                {user?.name}
              </p>
              <p className="truncate text-[11px] capitalize leading-tight text-ink-400">
                {user?.role.replace("_", " ")}
              </p>
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
                signOut();
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

function formatTimeAgo(dateString: string): string {
  const diff = Date.now() - new Date(dateString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function Sidebar({ collapsed }: { collapsed: boolean }) {
  const { buildingId } = useParams();
  const base = buildingId ? `/b/${buildingId}` : null;

  const globalItems = [
    { to: "/", icon: <Building2 size={18} />, label: "My Buildings" },
    { to: "/help", icon: <HelpCircle size={18} />, label: "Help" },
  ];

  const buildingGroups: {
    title?: string;
    items: { to: string; icon: React.ReactNode; label: string }[];
  }[] = base
    ? [
        {
          items: [
            {
              to: base,
              icon: <LayoutDashboard size={18} />,
              label: "Dashboard",
            },
            {
              to: `${base}/floors/floor-1`,
              icon: <LayoutGrid size={18} />,
              label: "Heatmap",
            },
            {
              to: `${base}/registry`,
              icon: <DoorOpen size={18} />,
              label: "All rooms",
            },
          ],
        },
        {
          title: "AI Center",
          items: [
            {
              to: `${base}/thermal`,
              icon: <Cpu size={18} />,
              label: "Thermal models",
            },
            {
              to: `${base}/mpc`,
              icon: <Cpu size={18} />,
              label: "MPC optimizer",
            },
            {
              to: `${base}/anomalies`,
              icon: <AlertTriangle size={18} />,
              label: "Anomalies",
            },
            {
              to: `${base}/diagnoses`,
              icon: <Activity size={18} />,
              label: "Diagnoses",
            },
          ],
        },
        {
          items: [
            {
              to: `${base}/alerts`,
              icon: <BellRing size={18} />,
              label: "Alerts",
            },
            {
              to: `${base}/reports`,
              icon: <FileBarChart size={18} />,
              label: "Reports",
            },
          ],
        },
        {
          items: [
            {
              to: `${base}/settings`,
              icon: <Settings size={18} />,
              label: "Settings",
            },
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
                isActive
                  ? "bg-primary-500 text-white"
                  : "text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800",
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
              <p
                className={clsx(
                  "px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-400",
                  collapsed && "hidden",
                )}
              >
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
                        : "text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800",
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
  const { orgId } = useAuth();
  const [buildings, setBuildings] = useState<Building[]>(mockBuildings);
  const [thermalModels, setThermalModels] = useState<ThermalModelRoom[]>([]);
  const [mpcRooms, setMpcRooms] = useState<MpcRoomSummary[]>([]);
  const [mpcLoading, setMpcLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchOrgBuildings(orgId ?? undefined)
      .then((dtos) => {
        if (!cancelled) setBuildings(dtos.map(toPortfolioBuilding));
      })
      .catch(() => {
        if (!cancelled) setBuildings(mockBuildings);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => {
    if (!buildingId) {
      setThermalModels([]);
      setMpcRooms([]);
      return;
    }
    let cancelled = false;
    setMpcLoading(true);
    Promise.all([
      fetchThermalModels(buildingId).catch(() => []),
      fetchMpcRooms(buildingId).catch(() => []),
    ])
      .then(([models, mpc]) => {
        if (!cancelled) {
          setThermalModels(models);
          setMpcRooms(mpc);
          setMpcLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setThermalModels([]);
          setMpcRooms([]);
          setMpcLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [buildingId]);

  const mpcActive = mpcRooms.length > 0;
  const latestMpcSolve = mpcRooms.length
    ? mpcRooms.map((r) => r.latestSolvedAt).sort((a, b) => +new Date(b) - +new Date(a))[0]
    : null;

  const calibratedModels = thermalModels.filter((m) => m.isCalibrated);
  const latestCalibration = calibratedModels.length
    ? calibratedModels.map((m) => m.calibratedAt).filter(Boolean).sort((a, b) => +new Date(b!) - +new Date(a!))[0]
    : null;

  const nextCalibrationHours = latestCalibration
    ? Math.max(0, Math.round((24 - ((Date.now() - new Date(latestCalibration).getTime()) / 36e5)) * 10) / 10)
    : null;

  return (
    <div className="flex h-screen overflow-hidden bg-[#f5f4f1] dark:bg-[#161512]">
      <aside
        className={clsx(
          "flex shrink-0 flex-col border-r border-ink-100 bg-white transition-[width] dark:border-ink-800 dark:bg-ink-950 dark:bg-[#1b1a17]",
          collapsed ? "w-[68px]" : "w-60",
        )}
      >
        <div
          className={clsx(
            "flex items-center gap-2 px-3 pt-3.5 pb-4",
            collapsed && "justify-center",
          )}
        >
          <img
            src="/logo_dynamIQ_icon.png"
            alt=""
            className="h-8 w-8 shrink-0"
          />
          {!collapsed && (
            <img
              src="/logo_dynamIQ_name.png"
              alt="DynamIQ"
              className="h-8 w-auto"
            />
          )}
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
            <BuildingSwitcher buildings={buildings} />
          </div>

          <SearchInput buildings={buildings} />

          <div className="flex items-center gap-1.5">
            <NotificationBell buildingId={buildingId} />
          </div>
        </header>

        {buildingId && (
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-ink-100 bg-ink-50/60 px-4 py-2 text-[12px] dark:border-ink-800 dark:bg-ink-800/30">
            <span
              className={clsx(
                "flex items-center gap-1.5",
                mpcActive
                  ? "text-teal-700 dark:text-teal-300"
                  : "text-ink-400",
              )}
            >
              <CpuIcon size={13} className={mpcActive ? "text-teal-500" : "text-ink-400"} />
              <span
                className={clsx(
                  "h-1.5 w-1.5 rounded-full",
                  mpcActive ? "bg-teal-500" : "bg-ink-300",
                )}
              />
              MPC {mpcActive ? "active" : "idle"}
              {mpcLoading && <span className="text-[10px] text-ink-400">(loading…)</span>}
            </span>
            {latestMpcSolve && (
              <span className="flex items-center gap-1.5 text-ink-500 dark:text-ink-300">
                <Timer size={12} /> MPC solved {formatTimeAgo(latestMpcSolve)}
              </span>
            )}
            {latestCalibration && (
              <span className="flex items-center gap-1.5 text-ink-500 dark:text-ink-300">
                <Timer size={12} /> Calibrated {formatTimeAgo(latestCalibration)}
                {nextCalibrationHours !== null && nextCalibrationHours > 0 && (
                  <> · Next in {nextCalibrationHours}h</>
                )}
              </span>
            )}
          </div>
        )}

        <main className="flex-1 overflow-y-auto app-scroll p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
