import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Search } from "lucide-react";
import { rooms, floors } from "../data/mock";
import { Card, StatusBadge, inputClass } from "../components/ui";

export default function AcRegistry() {
  const { buildingId = "esi-algiers" } = useParams();
  const [query, setQuery] = useState("");
  const buildingFloorIds = floors.filter((f) => f.buildingId === buildingId).map((f) => f.id);
  const buildingRooms = rooms.filter((r) => buildingFloorIds.includes(r.floorId));

  const filtered = useMemo(
    () =>
      buildingRooms.filter(
        (r) =>
          r.label.toLowerCase().includes(query.toLowerCase()) ||
          r.hvac.unitId.toLowerCase().includes(query.toLowerCase())
      ),
    [buildingRooms, query]
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-medium">AC registry</h1>
          <p className="mt-1 text-[13px] text-ink-400">Room to AC unit lookup across all floors.</p>
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
              <tr key={r.id} className="transition hover:bg-ink-50 dark:hover:bg-ink-800">
                <td className="px-5 py-3">
                  <Link to={`/b/${buildingId}/rooms/${r.id}`} className="font-medium hover:text-primary-600">
                    {r.label}
                  </Link>
                </td>
                <td className="px-5 py-3 text-ink-600">{floors.find((f) => f.id === r.floorId)?.label}</td>
                <td className="px-5 py-3 font-mono text-[13px]">{r.hvac.unitId}</td>
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