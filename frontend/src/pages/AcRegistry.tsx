import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Search, Snowflake } from "lucide-react";
import clsx from "clsx";
import { fetchAcRegistry } from "../lib/api";
import type { AcRegistryEntry } from "../lib/api";
import { Card, StatusBadge, inputClass } from "../components/ui";

export default function AcRegistry() {
  const { buildingId = "djezzy-hq" } = useParams();
  const [entries, setEntries] = useState<AcRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [floorFilter, setFloorFilter] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchAcRegistry(buildingId)
      .then((e) => active && setEntries(e))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [buildingId]);

  const floors = useMemo(
    () => [...new Set(entries.map((e) => e.floorLevel))].sort((a, b) => a - b),
    [entries]
  );

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          (floorFilter === null || e.floorLevel === floorFilter) &&
          (e.roomLabel.toLowerCase().includes(query.toLowerCase()) ||
            e.acId.toLowerCase().includes(query.toLowerCase()) ||
            (e.manufacturer ?? "").toLowerCase().includes(query.toLowerCase()))
      ),
    [entries, query, floorFilter]
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
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-teal-50 px-2.5 py-1 text-[12px] font-medium text-teal-700 dark:bg-teal-950 dark:text-teal-300">
              <Snowflake size={13} /> {entries.length} unit{entries.length === 1 ? "" : "s"} configured
            </span>
          </div>
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
          <span className="mr-1 text-[12px] font-medium uppercase tracking-wide text-ink-400">Floor</span>
          <button onClick={() => setFloorFilter(null)} className={chip(floorFilter === null)}>
            All
          </button>
          {floors.map((f) => (
            <button key={f} onClick={() => setFloorFilter(f)} className={chip(floorFilter === f)}>
              Floor {f}
            </button>
          ))}
        </div>
        <p className="ml-auto text-[12px] text-ink-400">{filtered.length} unit(s)</p>
      </div>

      <Card>
        {loading ? (
          <p className="px-5 py-6 text-center text-[13px] text-ink-400">Loading AC registry…</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-6 text-center text-[13px] text-ink-400">No AC units found.</p>
        ) : (
          <table className="w-full text-left text-[14px]">
            <thead>
              <tr className="border-b border-ink-100 text-[12px] uppercase tracking-wide text-ink-400 dark:border-ink-800">
                <th className="px-5 py-3 font-medium">Room</th>
                <th className="px-5 py-3 font-medium">Floor</th>
                <th className="px-5 py-3 font-medium">AC unit</th>
                <th className="px-5 py-3 font-medium">Model</th>
                <th className="px-5 py-3 font-medium">Capacity</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {filtered.map((e) => (
                <tr key={e.acId} className="transition hover:bg-ink-50 dark:hover:bg-ink-800">
                  <td className="px-5 py-3">
                    <Link to={`/b/${buildingId}/rooms/${e.roomId}`} className="font-medium hover:text-primary-600">
                      {e.roomLabel}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-ink-600">Floor {e.floorLevel}</td>
                  <td className="px-5 py-3 text-[13px]">{e.acId}</td>
                  <td className="px-5 py-3 text-ink-600">
                    {e.manufacturer ? `${e.manufacturer}${e.model ? ` ${e.model}` : ""}` : e.model ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-ink-600">
                    {e.coolingCapacityKw !== null ? `${e.coolingCapacityKw.toFixed(1)} kW` : "—"}
                    {e.powerKw !== null ? ` · ${e.powerKw.toFixed(1)} kW power` : ""}
                  </td>
                  <td className="px-5 py-3"><StatusBadge status={e.status === "active" ? "online" : "maintenance"} label={e.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}