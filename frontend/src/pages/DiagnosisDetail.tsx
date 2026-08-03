import { useParams, Link } from "react-router-dom";
import { CheckCircle2, Wrench } from "lucide-react";
import { anomalyById, diagnosisByAnomalyId, roomById } from "../data/mock";
import { Card, CardHeader, StatusBadge, PrimaryButton, SecondaryButton } from "../components/ui";

export default function DiagnosisDetail() {
  const { buildingId = "esi-algiers", anomalyId = "" } = useParams();
  const anomaly = anomalyById(anomalyId);
  const diagnosis = diagnosisByAnomalyId(anomalyId);
  const room = anomaly ? roomById(anomaly.roomId) : undefined;

  if (!anomaly) return <p className="text-[14px] text-ink-400">Anomaly not found.</p>;

  return (
    <div className="mx-auto max-w-4xl">
      <p className="text-[12px] text-ink-400">
        <Link to={`/b/${buildingId}/anomalies`} className="hover:text-primary-600">Anomalies</Link> / {room?.label}
      </p>
      <div className="mt-1 flex items-center gap-3">
        <h1 className="text-[20px] font-medium">{room?.label} — thermal anomaly</h1>
        <StatusBadge status={anomaly.severity} />
        <StatusBadge status={anomaly.status} />
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <Card className="p-4"><p className="text-[12px] text-ink-400">Predicted</p><p className="text-xl font-medium">{anomaly.predictedC}°C</p></Card>
        <Card className="p-4"><p className="text-[12px] text-ink-400">Measured</p><p className="text-xl font-medium">{anomaly.measuredC}°C</p></Card>
        <Card className="p-4"><p className="text-[12px] text-ink-400">Delta</p><p className="text-xl font-medium text-red-700 dark:text-red-300">+{anomaly.deltaC}°C</p></Card>
      </div>

      {diagnosis ? (
        <>
          <Card className="mt-5">
            <CardHeader title="Diagnostic diagnosis" subtitle={`Confidence ${diagnosis.confidencePct}%`} />
            <div className="px-5 pb-5">
              <p className="text-[14px] leading-relaxed">{diagnosis.cause}</p>
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-primary-50 p-4 dark:bg-primary-900/40">
                <Wrench size={16} className="mt-0.5 shrink-0 text-primary-600 dark:text-primary-400" />
                <div>
                  <p className="text-[13px] font-medium text-primary-800 dark:text-primary-300">Proposed action</p>
                  <p className="text-[13px] text-primary-700 dark:text-primary-400">{diagnosis.proposedAction}</p>
                </div>
              </div>
            </div>
          </Card>

          <Card className="mt-5">
            <CardHeader title="Evidence gathered" subtitle="7 read-only tools available to the diagnostic agent" />
            <div className="divide-y divide-ink-100 dark:divide-ink-800">
              {diagnosis.evidence.map((e, i) => (
                <div key={i} className="flex items-start gap-3 px-5 py-3.5">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-teal-600" />
                  <div>
                    <p className="font-mono text-[12px] text-ink-400">{e.tool}</p>
                    <p className="text-[14px]">{e.finding}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="mt-5 p-5">
            <p className="text-[13px] text-ink-400">Supervisor decision</p>
            <div className="mt-2 flex items-center justify-between">
              <StatusBadge status={diagnosis.decision === "human_alert" ? "medium" : "low"} label={diagnosis.decision.replace("_", " ")} />
              <div className="flex gap-2">
                <SecondaryButton>Mark resolved</SecondaryButton>
                <PrimaryButton>Acknowledge alert</PrimaryButton>
              </div>
            </div>
          </Card>
        </>
      ) : (
        <Card className="mt-5 p-6 text-center text-[14px] text-ink-400">The diagnostic agent is still gathering evidence…</Card>
      )}
    </div>
  );
}