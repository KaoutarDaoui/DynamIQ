import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import clsx from "clsx";
import { ApiError, deleteBuilding, fetchAlertEmail, ThermalApiError, updateAlertEmail } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card, CardHeader, ConfirmDialog, Field, PrimaryButton, SecondaryButton, StatusBadge, inputClass } from "../components/ui";

const tabs = ["Users & roles", "Building", "Integrations", "Calibration"] as const;

const teamMembers = [
  { name: "Amira Rezzoug", email: "mr_amira@esi.dz", role: "admin" as const },
  { name: "Iratni Sara", email: "iratni.sara@esi.dz", role: "facility_manager" as const },
  { name: "Daoui Kaoutar", email: "daoui.kaoutar@esi.dz", role: "technician" as const },
  { name: "Djezzy stakeholder", email: "viewer@djezzy.dz", role: "viewer" as const },
];

function AlertEmailCard({ buildingId }: { buildingId: string }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAlertEmail(buildingId)
      .then((value) => {
        if (!cancelled) setEmail(value ?? "");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ThermalApiError ? err.message : "Failed to load alert email");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [buildingId]);

  function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    updateAlertEmail(buildingId, email)
      .then(() => setSaved(true))
      .catch((err: unknown) => setError(err instanceof ThermalApiError ? err.message : "Failed to save alert email"))
      .finally(() => setSaving(false));
  }

  return (
    <Card className="mt-5 p-5">
      <CardHeader title="Alert notifications" subtitle="Where Agent 4 sends an email when a diagnosis needs a human — one address for this building's organisation." />
      <div className="flex flex-col gap-4 px-0 pt-4">
        <Field label="Alert email" hint="Falls back to SUPERVISOR_ALERT_EMAIL_TO in the backend config if left empty.">
          <input
            className={inputClass}
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setSaved(false);
            }}
            placeholder="facilities@yourcompany.com"
            disabled={loading}
          />
        </Field>
        {error && (
          <p className="flex items-center gap-1.5 text-[13px] text-red-600 dark:text-red-400">
            <AlertTriangle size={14} /> {error}
          </p>
        )}
        {saved && !error && (
          <p className="flex items-center gap-1.5 text-[13px] text-teal-600 dark:text-teal-400">
            <CheckCircle2 size={14} /> Saved
          </p>
        )}
        <div className="flex justify-end">
          <PrimaryButton onClick={handleSave} className={loading || saving ? "pointer-events-none opacity-50" : undefined}>
            {saving ? "Saving…" : "Save alert email"}
          </PrimaryButton>
        </div>
      </div>
    </Card>
  );
}

function DangerZoneCard({ buildingId }: { buildingId: string }) {
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setDeleting(true);
    setError(null);
    deleteBuilding(buildingId)
      .then(() => navigate("/"))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Could not delete this building.");
      })
      .finally(() => setDeleting(false));
  }

  return (
    <Card className="mt-5 border-red-200 p-5 dark:border-red-900">
      <CardHeader title="Danger zone" subtitle="Permanently delete this building and everything under it." />
      <div className="flex items-center justify-between px-0 pt-2">
        <p className="max-w-md text-[13px] text-ink-400">
          Removes the building, its floors and rooms, and all sensor history, calibration data, and schedules. This
          cannot be undone.
        </p>
        <SecondaryButton
          onClick={() => setConfirmOpen(true)}
          className="shrink-0 border-red-200 text-red-600 hover:border-red-300 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          Delete building
        </SecondaryButton>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={`Delete "${buildingId}"?`}
        message={
          <>
            <p>
              This permanently deletes the building, its floors and rooms, and all sensor history, calibration data,
              and schedules for it. This cannot be undone.
            </p>
            {error && (
              <p className="mt-2 flex items-center gap-1.5 text-red-600 dark:text-red-400">
                <AlertTriangle size={13} /> {error}
              </p>
            )}
          </>
        }
        confirmLabel="Delete building"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => {
          setConfirmOpen(false);
          setError(null);
        }}
      />
    </Card>
  );
}

export default function Settings() {
  const { buildingId = "esi-algiers" } = useParams();
  const { user } = useAuth();
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
          <CardHeader title="Team" subtitle={user ? `Signed in as ${user.email}` : undefined} action={<PrimaryButton>Invite member</PrimaryButton>} />
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

      {tab === "Building" && <AlertEmailCard buildingId={buildingId} />}
      {tab === "Building" && <DangerZoneCard buildingId={buildingId} />}

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