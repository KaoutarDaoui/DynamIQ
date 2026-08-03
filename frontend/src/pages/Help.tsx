import { Link } from "react-router-dom";
import { LifeBuoy, MessageSquare, BookOpen } from "lucide-react";
import { Card, Field, PrimaryButton, inputClass } from "../components/ui";

const faqs = [
  { q: "Why did a room get flagged as an anomaly?", a: "Agent 2 compares its RC-model prediction to the live sensor reading. A gap above the configured threshold (default 1.5°C) raises a thermal_anomaly, which wakes Agent 3." },
  { q: "Who decides if an alert goes to a technician?", a: "Agent 4's Supervisor is a fully deterministic decision layer — the diagnostic LLM's own opinion never decides whether an action is safe." },
  { q: "How often is the RC model recalibrated?", a: "By default once a day against the last 14 days of sensor history — configurable under Settings → Calibration." },
];

export default function Help() {
  return (
    <div className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <Link to="/" className="text-[13px] text-ink-400 hover:text-primary-600">← Back to portfolio</Link>
      <h1 className="mt-3 text-[22px] font-medium">Help center</h1>
      <p className="mt-1 text-[13px] text-ink-400">Documentation, FAQs, and a direct line to the team.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-5 text-center"><BookOpen className="mx-auto text-primary-500" size={22} /><p className="mt-2 text-[13px] font-medium">Documentation</p></Card>
        <Card className="p-5 text-center"><LifeBuoy className="mx-auto text-primary-500" size={22} /><p className="mt-2 text-[13px] font-medium">System status</p></Card>
        <Card className="p-5 text-center"><MessageSquare className="mx-auto text-primary-500" size={22} /><p className="mt-2 text-[13px] font-medium">Contact support</p></Card>
      </div>

      <Card className="mt-6">
        <div className="divide-y divide-ink-100 dark:divide-ink-800">
          {faqs.map((f) => (
            <div key={f.q} className="px-5 py-4">
              <p className="text-[14px] font-medium">{f.q}</p>
              <p className="mt-1 text-[13px] text-ink-600">{f.a}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-6 p-5">
        <p className="text-[15px] font-medium">Still stuck?</p>
        <div className="mt-4 flex flex-col gap-4">
          <Field label="Describe the issue">
            <textarea className={`${inputClass} min-h-24`} placeholder="What were you trying to do?" />
          </Field>
          <div className="flex justify-end"><PrimaryButton>Send message</PrimaryButton></div>
        </div>
      </Card>
    </div>
  );
}