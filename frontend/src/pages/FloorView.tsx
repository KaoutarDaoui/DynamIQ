import { Link, useParams } from "react-router-dom";
import clsx from "clsx";
import { floors, roomsByFloor } from "../data/mock";
import { Card, CardHeader, StatusBadge } from "../components/ui";

function tempColor(current: number, target: number) {
  const delta = current - target;
  if (delta > 2) return "bg-red-500/15 border-red-500/40";
  if (delta > 0.8) return "bg-amber-500/15 border-amber-500/40";
  return "bg-teal-500/12 border-teal-500/35";
}

export default function FloorView() {
  const { buildingId = "esi-algiers", floorId = "floor-1" } = useParams();
  const floor = floors.find((f) => f.id === floorId);
  const floorList = floors.filter((f) => f.buildingId === buildingId);
  const roomList = roomsByFloor(floorId);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex items-center gap-2">
        {floorList.map((f) => (
          <Link
            key={f.id}
            to={`/b/${buildingId}/floors/${f.id}`}
            className={clsx(
              "rounded-full px-3.5 py-1.5 text-[13px] font-medium",
              f.id === floorId ? "bg-primary-500 text-white" : "bg-white border border-ink-100 text-ink-600 hover:border-primary-300 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-300 dark:hover:border-primary-600"
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader title={floor?.label ?? "Floor"} subtitle="Room grid, colored by deviation from target temperature" />
        <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-3 lg:grid-cols-4">
          {roomList.map((r) => (
            <Link
              key={r.id}
              to={`/b/${buildingId}/rooms/${r.id}`}
              className={clsx("rounded-xl border p-4 transition hover:shadow-md", tempColor(r.currentTempC, r.targetTempC))}
            >
              <div className="flex items-start justify-between">
                <p className="text-[14px] font-medium">{r.label}</p>
                <StatusBadge status={r.status} label={r.status} />
              </div>
              <p className="mt-3 text-2xl font-medium">{r.currentTempC}°C</p>
              <p className="text-[12px] text-ink-400">target {r.targetTempC}°C · predicted {r.predictedTempC}°C</p>
              <p className="mt-2 text-[12px] text-ink-400">{r.hvac.unitId} · {r.hvac.status}</p>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}