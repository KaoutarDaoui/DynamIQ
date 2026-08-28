import { useEffect, useState } from "react";
import {
  NavLink,
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  Sun,
  Moon,
  Bell,
  ChevronDown,
  LayoutDashboard,
  Thermometer,
  AlertTriangle,
  Settings,
  HelpCircle,
  LogOut,
  Building2,
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
  return { dark, toggle: () => setDark((value) => !value) };
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
        onClick={() => setOpen((value) => !value)}
        aria-label="Notifications"
      >
        <Bell size={18} />
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-xl border border-ink-100 bg-white shadow-lg dark:border-ink-800 dark:bg-ink-900">
            <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3 dark:border-ink-800">
              <p className="text-[14px] font-medium dark:text-white">
                Notifications
              </p>
              <span className="rounded-full bg-primary-500/10 px-2 py-0.5 text-[11px] font-medium text-primary-700">
                {unreadCount} {unreadCount === 1 ? "alert" : "alerts"}
              </span>
            </div>
            <div className="divide-y divide-ink-100 dark:divide-ink-800">
              {notifications.map((notification) => (
                <div key={notification.id} className="px-4 py-3">
                  <p className="text-[13px] font-medium text-ink-900 dark:text-ink-50">
                    {notification.title}
                  </p>
                  <p className="text-[12px] text-ink-400">
                    {notification.time}
                  </p>
                </div>
              ))}
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
  const current = buildings.find((building) => building.id === buildingId);
  return (
    <div className="relative">
      <button
        className="flex items-center gap-2 rounded-full bg-transparent px-3 py-2 text-[13px] font-medium text-ink-700 transition hover:bg-white dark:text-ink-200 dark:hover:bg-ink-900"
        onClick={() => setOpen((value) => !value)}
        aria-label="Select building"
      >
        <Building2 size={16} className="shrink-0 text-ink-500" />
        <span className="max-w-40 truncate">
          {current ? current.name : "Select building"}
        </span>
        <ChevronDown size={16} className="shrink-0 text-ink-300" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-30 mt-2 w-56 overflow-hidden rounded-xl border border-ink-100 bg-white py-1 shadow-lg dark:border-ink-800 dark:bg-ink-900">
            <Link
              to="/"
              onClick={() => setOpen(false)}
              className="block px-3.5 py-2 text-[13px] font-medium text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800"
            >
              All buildings
            </Link>
            <div className="my-1 h-px bg-ink-100 dark:bg-ink-800" />
            {buildings.map((building) => (
              <Link
                key={building.id}
                to={`/b/${building.id}`}
                onClick={() => setOpen(false)}
                className={clsx(
                  "flex items-center gap-2.5 px-3.5 py-2 text-[13px] hover:bg-ink-50 dark:hover:bg-ink-800",
                  building.id === buildingId
                    ? "bg-primary-500/10 font-medium text-primary-700"
                    : "text-ink-700 dark:text-ink-200",
                )}
              >
                <Building2 size={15} />
                {building.name}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

type RailLink = {
  key: string;
  to: string;
  label: string;
  icon: React.ReactNode;
  end?: boolean;
};
function RailLink({ item }: { item: RailLink }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={item.label}
      aria-label={item.label}
      className={({ isActive }) =>
        clsx(
          "flex h-10 w-10 aspect-square items-center justify-center rounded-full transition",
          isActive
            ? "bg-primary-500 text-white"
            : "text-ink-400 hover:bg-ink-50 dark:hover:bg-ink-800",
        )
      }
    >
      {item.icon}
    </NavLink>
  );
}

function FloatingRail({
  base,
  dark,
  toggleTheme,
}: {
  base: string | null;
  dark: boolean;
  toggleTheme: () => void;
}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);
  const links: RailLink[] = base
    ? [
        {
          key: "dashboard",
          to: base,
          label: "Dashboard",
          icon: <LayoutDashboard size={18} strokeWidth={1.75} />,
          end: true,
        },
        {
          key: "thermal",
          to: `${base}/thermal`,
          label: "Thermal anomalies",
          icon: <Thermometer size={18} strokeWidth={1.75} />,
        },
        {
          key: "anomalies",
          to: `${base}/anomalies`,
          label: "Anomalies",
          icon: <AlertTriangle size={18} strokeWidth={1.75} />,
        },
      ]
    : [];
  const settings: RailLink = {
    key: "settings",
    to: base ? `${base}/settings` : "/settings",
    label: base ? "Building settings" : "General settings",
    icon: <Settings size={18} strokeWidth={1.75} />,
  };
  const generalDashboard: RailLink = {
    key: "general-dashboard",
    to: "/dashboard",
    label: "General dashboard",
    icon: <LayoutDashboard size={18} strokeWidth={1.75} />,
    end: true,
  };
  const myBuildings: RailLink = {
    key: "buildings",
    to: "/",
    label: "My buildings",
    icon: <Building2 size={18} strokeWidth={1.75} />,
    end: true,
  };
  return (
    <nav
      className="fixed bottom-6 left-6 z-40 flex flex-col items-center gap-2 rounded-[30px] border border-ink-100/60 bg-white/95 px-2.5 py-2.5 shadow-[0_4px_20px_rgba(0,0,0,0.08)] backdrop-blur dark:border-ink-800/60 dark:bg-ink-900/95"
      aria-label="Primary"
    >
      {!base && <RailLink item={generalDashboard} />}
      <RailLink item={myBuildings} />
      {links.map((item) => (
        <RailLink key={item.key} item={item} />
      ))}
      <RailLink item={settings} />
      <div className="my-1 h-5 border-t border-ink-100 dark:border-ink-800" />
      <RailLink
        item={{
          key: "help",
          to: "/help",
          label: "Help center",
          icon: <HelpCircle size={18} strokeWidth={1.75} />,
        }}
      />
      <div className="relative">
        <button
          className="flex h-10 w-10 aspect-square items-center justify-center rounded-full bg-primary-100 text-[12px] font-medium text-primary-700 transition hover:brightness-95 dark:bg-primary-800 dark:text-primary-200"
          onClick={() => setProfileOpen((value) => !value)}
          aria-label="Profile"
          title={user?.name}
        >
          {user?.avatarInitials}
        </button>
        {profileOpen && (
          <>
            <div
              className="fixed inset-0 z-30"
              onClick={() => setProfileOpen(false)}
            />
            <div className="absolute left-full top-1/2 z-40 ml-3 w-52 -translate-y-1/2 overflow-hidden rounded-xl border border-ink-100 bg-white py-2 shadow-lg dark:border-ink-800 dark:bg-ink-900">
              <div className="px-3.5 py-1.5">
                <p className="truncate text-[13px] font-medium text-ink-900 dark:text-ink-50">
                  {user?.name}
                </p>
                <p className="truncate text-[11px] capitalize text-ink-400">
                  {user?.role.replace("_", " ")}
                </p>
              </div>
              <button
                className="mt-1 flex w-full items-center gap-2 px-3.5 py-2 text-[13px] text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800"
                onClick={() => {
                  setProfileOpen(false);
                  toggleTheme();
                }}
              >
                {dark ? <Sun size={15} /> : <Moon size={15} />}
                {dark ? "Light mode" : "Dark mode"}
              </button>
            </div>
          </>
        )}
      </div>
      <button
        className="flex h-10 w-10 aspect-square items-center justify-center rounded-full text-ink-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
        onClick={() => {
          signOut();
          navigate("/login");
        }}
        aria-label="Log out"
        title="Log out"
      >
        <LogOut size={18} strokeWidth={1.75} />
      </button>
    </nav>
  );
}

function BuildingTabs({ base }: { base: string }) {
  const { pathname } = useLocation();
  const groups = [
    {
      label: "Dashboard",
      links: [
        { to: base, label: "Dashboard", end: true },
        { to: `${base}/floors/floor-1`, label: "Heatmap" },
        { to: `${base}/registry`, label: "All rooms" },
      ],
    },
    {
      label: "Thermal anomalies",
      links: [
        { to: `${base}/thermal`, label: "Thermal anomalies" },
        { to: `${base}/mpc`, label: "MPC optimizer" },
      ],
    },
    {
      label: "Anomalies",
      links: [
        { to: `${base}/anomalies`, label: "Anomalies" },
        { to: `${base}/diagnoses`, label: "Diagnoses" },
        { to: `${base}/alerts`, label: "Alerts" },
        { to: `${base}/reports`, label: "Reports" },
      ],
    },
  ];
  const activeGroup =
    groups.find((group) =>
      group.links.some(
        (link) =>
          pathname === link.to ||
          (!link.end && pathname.startsWith(`${link.to}/`)),
      ),
    ) ?? groups[0];
  return (
    <div className="absolute left-1/2 flex w-fit max-w-[calc(100%-2rem)] min-w-0 -translate-x-1/2 items-center justify-center gap-1 overflow-x-auto rounded-full border border-ink-100/60 bg-white/95 px-2 py-1.5 shadow-[0_4px_20px_rgba(0,0,0,0.08)] backdrop-blur dark:border-ink-800/60 dark:bg-ink-900/95">
      {activeGroup.links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.end}
          className={({ isActive }) =>
            clsx(
              "whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-medium transition",
              isActive
                ? "bg-primary-500 text-white"
                : "text-ink-500 hover:bg-ink-50 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800",
            )
          }
        >
          {link.label}
        </NavLink>
      ))}
    </div>
  );
}

export default function AppLayout() {
  const { dark, toggle } = useTheme();
  const { buildingId } = useParams();
  const { orgId, user } = useAuth();
  const [buildings, setBuildings] = useState<Building[]>(mockBuildings);
  const base = buildingId ? `/b/${buildingId}` : null;
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
  return (
    <div className="relative flex h-screen overflow-hidden bg-[#EEEEF2] dark:bg-[#161512]">
      <FloatingRail base={base} dark={dark} toggleTheme={toggle} />
      <div className="flex min-w-0 flex-1 flex-col pl-24">
        <header className="relative flex h-20 shrink-0 items-center gap-4 px-6 pt-4">
          <div className="-ml-24 flex shrink-0 items-center gap-3">
            <img src="/logo_dynamIQ_icon.png" alt="" className="h-7 w-7" />
            <img
              src="/logo_dynamIQ_name.png"
              alt="DynamIQ"
              className="h-10 w-auto"
            />
          </div>
          {base && <BuildingTabs base={base} />}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <BuildingSwitcher buildings={buildings} />
            <NotificationBell />
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-[11px] font-medium text-primary-700 transition hover:brightness-95 dark:bg-primary-800 dark:text-primary-200"
              aria-label="Profile"
              title={user?.name}
            >
              {user?.avatarInitials}
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto app-scroll px-8 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
