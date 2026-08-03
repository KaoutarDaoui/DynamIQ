import { Link, useParams } from "react-router-dom";
import { anomalies, roomById } from "../data/mock";
import { Card, StatusBadge } from "../components/ui";

export default function Anomalies() {
  const { buildingId = "esi-algiers" } = useParams();

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-[20px] font-medium">Anomalies</h1>
      <p className="mt-1 text-[13px] text-ink-400">Raised whenever a room's measured temperature diverges from Agent 2's prediction.</p>

      <div className="mt-6 flex flex-col gap-3">
        {anomalies.map((a) => {
          const room = roomById(a.roomId);
          return (
            <Link key={a.id} to={`/b/${buildingId}/anomalies/${a.id}`}>
              <Card className="flex items-center justify-between p-4 transition hover:border-primary-300">
                <div className="flex items-center gap-4">
                  <div className={`h-2.5 w-2.5 rounded-full ${a.severity === "high" ? "bg-red-500" : a.severity === "medium" ? "bg-amber-500" : "bg-teal-500"}`} />
                  <div>
                    <p className="text-[14px] font-medium">{room?.label ?? a.roomId}</p>
                    <p className="text-[12px] text-ink-400">
                      {new Date(a.raisedAt).toLocaleString()} · predicted {a.predictedC}°C vs measured {a.measuredC}°C
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={a.severity} />
                  <StatusBadge status={a.status} />
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}