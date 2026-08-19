import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Search, WifiOff, Wrench } from "lucide-react";
import clsx from "clsx";
import { rooms, floors } from "../data/mock";
import { Card, StatusBadge, inputClass } from "../components/ui";

const TYPE_FILTERS = ["all", "split_unit", "vrf"] as const;
const STATUS_FILTERS = ["all", "online", "offline", "maintenance"] as const;

export default function AcRegistry() {
  const { buildingId = "esi-algiers" } = useParams();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTERS)[number]>("all");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");

  const buildingFloorIds = floors.filter((f) => f.buildingId === buildingId).map((f) => f.id);
  const buildingRooms = rooms.filter((r) => buildingFloorIds.includes(r.floorId));

  const offline = useMemo(
    () => buildingRooms.filter((r) => r.hvac.status === "offline").length,
    [buildingRooms]
  );
  const maintenance = useMemo(
    () => buildingRooms.filter((r) => r.hvac.status === "maintenance").length,
    [buildingRooms]
  );

  const filtered = useMemo(
    () =>
      buildingRooms.filter(
        (r) =>
          (typeFilter === "all" || r.hvac.type === typeFilter) &&
          (statusFilter === "all" || r.hvac.status === statusFilter) &&
          (r.label.toLowerCase().includes(query.toLowerCase()) ||
            r.hvac.unitId.toLowerCase().includes(query.toLowerCase()))
      ),
    [buildingRooms, query, typeFilter, statusFilter]
  );

  const chip = (active: boolean) =>
    clsx(
      "rounded-full border px-3 py-1.5 text-[12px] font-medium transition",
      active
        ? "border-primary-500 bg-primary-500 text-white"
        : "border-ink-200 bg-white text-ink-600 hover:border-primary-300 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300"
    );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-medium">AC registry</h1>
          <p className="mt-1 text-[13px] text-ink-400">Room to AC unit lookup across all floors.</p>
          {(offline > 0 || maintenance > 0) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {offline > 0 && (
                <span className="flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-[12px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                  <WifiOff size={13} /> {offline} unit{offline === 1 ? "" : "s"} offline
                </span>
              )}
              {maintenance > 0 && (
                <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  <Wrench size={13} /> {maintenance} in maintenance
                </span>
              )}
            </div>
          )}
        </div>
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            className={`${inputClass} w-64 pl-9`}
            placeholder="Search room or unit…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] font-medium uppercase tracking-wide text-ink-400">Type</span>
          {TYPE_FILTERS.map((t) => (
            <button key={t} onClick={() => setTypeFilter(t)} className={chip(typeFilter === t)}>
              {t === "all" ? "All" : t.replace("_", " ")}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] font-medium uppercase tracking-wide text-ink-400">Status</span>
          {STATUS_FILTERS.map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)} className={chip(statusFilter === s)}>
              {s === "all" ? "All" : s}
            </button>
          ))}
        </div>
        <p className="ml-auto text-[12px] text-ink-400">{filtered.length} unit(s)</p>
      </div>

      <Card>
        <table className="w-full text-left text-[14px]">
          <thead>
            <tr className="border-b border-ink-100 text-[12px] uppercase tracking-wide text-ink-400 dark:border-ink-800">
              <th className="px-5 py-3 font-medium">Room</th>
              <th className="px-5 py-3 font-medium">Floor</th>
              <th className="px-5 py-3 font-medium">AC unit</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Capacity</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
            {filtered.map((r) => (
              <tr
                key={r.id}
                className={clsx(
                  "transition hover:bg-ink-50 dark:hover:bg-ink-800",
                  r.hvac.status === "offline" && "bg-red-50/40 dark:bg-red-950/20",
                  r.hvac.status === "maintenance" && "bg-amber-50/40 dark:bg-amber-950/20"
                )}
              >
                <td className="px-5 py-3">
                  <Link to={`/b/${buildingId}/rooms/${r.id}`} className="font-medium hover:text-primary-600">
                    {r.label}
                  </Link>
                </td>
                <td className="px-5 py-3 text-ink-600">{floors.find((f) => f.id === r.floorId)?.label}</td>
                <td className="px-5 py-3 text-[13px]">{r.hvac.unitId}</td>
                <td className="px-5 py-3 capitalize text-ink-600">{r.hvac.type.replace("_", " ")}</td>
                <td className="px-5 py-3 text-ink-600">{r.hvac.capacityKw} kW</td>
                <td className="px-5 py-3"><StatusBadge status={r.hvac.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
