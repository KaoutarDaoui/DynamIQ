import { alerts, roomById } from "../data/mock";
import { Card, StatusBadge, SecondaryButton } from "../components/ui";

export default function Alerts() {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-[20px] font-medium">Alerts</h1>
      <p className="mt-1 text-[13px] text-ink-400">Dispatched whenever the Supervisor routes a diagnosis to human_alert.</p>

      <div className="mt-6 flex flex-col gap-3">
        {alerts.map((a) => {
          const room = roomById(a.roomId);
          return (
            <Card key={a.id} className="flex items-center justify-between p-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[14px] font-medium">{room?.label}</p>
                  <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium capitalize text-ink-600 dark:bg-ink-800 dark:text-ink-300">{a.channel}</span>
                  <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium capitalize text-ink-600 dark:bg-ink-800 dark:text-ink-300">{a.assignedRole.replace("_", " ")}</span>
                </div>
                <p className="mt-1 text-[13px] text-ink-600">{a.message}</p>
                <p className="mt-1 text-[12px] text-ink-400">{new Date(a.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={a.acknowledged ? "resolved" : "medium"} label={a.acknowledged ? "acknowledged" : "pending"} />
                {!a.acknowledged && <SecondaryButton>Acknowledge</SecondaryButton>}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}