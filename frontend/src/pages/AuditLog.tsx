import { auditLog } from "../data/mock";
import { Card } from "../components/ui";

export default function AuditLogPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-[20px] font-medium">Audit log</h1>
      <p className="mt-1 text-[13px] text-ink-400">Every autonomous action, alert and manual override, timestamped.</p>

      <Card className="mt-6">
        <ol className="divide-y divide-ink-100 dark:divide-ink-800">
          {auditLog.map((e) => (
            <li key={e.id} className="flex gap-4 px-5 py-4">
              <div className="w-36 shrink-0 text-[12px] text-ink-400">{new Date(e.timestamp).toLocaleString()}</div>
              <div>
                <p className="text-[14px] font-medium">
                  {e.actor} <span className="font-normal text-ink-400">— {e.action}</span>
                </p>
                <p className="text-[13px] text-ink-600">{e.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}