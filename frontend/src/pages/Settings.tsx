import { useState } from "react";
import clsx from "clsx";
import { currentUser } from "../data/mock";
import { Card, CardHeader, Field, PrimaryButton, SecondaryButton, StatusBadge, inputClass } from "../components/ui";

const tabs = ["Users & roles", "Building", "Integrations", "Calibration"] as const;

const teamMembers = [
  { name: "Amira Rezzoug", email: "mr_amira@esi.dz", role: "admin" as const },
  { name: "Iratni Sara", email: "iratni.sara@esi.dz", role: "facility_manager" as const },
  { name: "Daoui Kaoutar", email: "daoui.kaoutar@esi.dz", role: "technician" as const },
  { name: "Djezzy stakeholder", email: "viewer@djezzy.dz", role: "viewer" as const },
];

export default function Settings() {
  const [tab, setTab] = useState<(typeof tabs)[number]>("Users & roles");

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-[20px] font-medium">Settings</h1>
      <p className="mt-1 text-[13px] text-ink-400">Manage access, building data and system integrations.</p>

      <div className="mt-6 flex gap-1 rounded-xl bg-ink-100 p-1 dark:bg-ink-800">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              "flex-1 rounded-lg px-3 py-2 text-[13px] font-medium transition",
              tab === t ? "bg-white text-ink-900 shadow-sm dark:bg-ink-700 dark:text-ink-50" : "text-ink-500 dark:text-ink-400"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Users & roles" && (
        <Card className="mt-5">
          <CardHeader title="Team" subtitle={`Signed in as ${currentUser.email}`} action={<PrimaryButton>Invite member</PrimaryButton>} />
          <div className="divide-y divide-ink-100 dark:divide-ink-800">
            {teamMembers.map((m) => (
              <div key={m.email} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <p className="text-[14px] font-medium">{m.name}</p>
                  <p className="text-[12px] text-ink-400">{m.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  <select defaultValue={m.role} className={`${inputClass} w-44`}>
                    <option value="admin">Admin</option>
                    <option value="facility_manager">Facility manager</option>
                    <option value="technician">Technician</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <StatusBadge status="online" label="active" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "Building" && (
        <Card className="mt-5 p-5">
          <CardHeader title="Building details" subtitle="Editing these does not re-run building analysis unless you upload a new plan." />
          <div className="flex flex-col gap-4 px-0 pt-4">
            <Field label="Building name"><input className={inputClass} defaultValue="ESI Algiers" /></Field>
            <Field label="Address"><input className={inputClass} defaultValue="Oued Smar, Algiers" /></Field>
            <Field label="Floors" hint="Add a floor to trigger a new plan upload."><input className={inputClass} defaultValue={4} type="number" /></Field>
            <div className="flex justify-end"><PrimaryButton>Save changes</PrimaryButton></div>
          </div>
        </Card>
      )}

      {tab === "Integrations" && (
        <Card className="mt-5 p-5">
          <CardHeader title="Integrations" subtitle="Alert delivery and forecast providers" />
          <div className="flex flex-col gap-4 px-0 pt-4">
            <Field label="Alert webhook URL" hint="Human alerts are POSTed here in addition to the in-app inbox.">
              <input className={inputClass} placeholder="https://hooks.slack.com/services/…" />
            </Field>
            <Field label="Weather provider"><input className={inputClass} defaultValue="Open-Meteo" disabled /></Field>
            <Field label="Carbon intensity provider"><input className={inputClass} defaultValue="ElectricityMaps" disabled /></Field>
            <div className="flex justify-end"><PrimaryButton>Save integrations</PrimaryButton></div>
          </div>
        </Card>
      )}

      {tab === "Calibration" && (
        <Card className="mt-5 p-5">
          <CardHeader title="Calibration thresholds" subtitle="Controls when thermal prediction raises a thermal_anomaly" />
          <div className="flex flex-col gap-4 px-0 pt-4">
            <Field label="Anomaly delta threshold (°C)" hint="Predicted vs measured gap that triggers an anomaly."><input className={inputClass} defaultValue={1.5} type="number" step={0.1} /></Field>
            <Field label="Calibration sweep frequency"><input className={inputClass} defaultValue="Daily, 06:00" disabled /></Field>
            <div className="flex justify-end gap-2">
              <SecondaryButton>Run calibration now</SecondaryButton>
              <PrimaryButton>Save thresholds</PrimaryButton>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}