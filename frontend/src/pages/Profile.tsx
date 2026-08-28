import { useNavigate } from "react-router-dom";
import { LogOut, Mail, ShieldCheck } from "lucide-react";
import { Card, CardHeader, Field, SecondaryButton, inputClass } from "../components/ui";
import { useAuth } from "../lib/auth";

const roleLabels: Record<string, string> = {
  admin: "Admin",
  facility_manager: "Facility manager",
  technician: "Technician",
  viewer: "Viewer",
};

export default function Profile() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-[20px] font-medium">Profile</h1>
      <p className="mt-1 text-[13px] text-ink-400">Your account details.</p>

      <Card className="mt-6 flex items-center gap-4 p-5">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[18px] font-medium text-primary-700 dark:bg-primary-800 dark:text-primary-200">
          {user?.avatarInitials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[16px] font-medium text-ink-900 dark:text-white">
            {user?.name}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-ink-400">
            <Mail size={13} className="shrink-0" />
            {user?.email}
          </p>
        </div>
      </Card>

      <Card className="mt-5">
        <CardHeader title="Account details" />
        <div className="flex flex-col gap-4 px-5 pb-5 pt-2">
          <Field label="Full name">
            <input className={inputClass} value={user?.name ?? ""} disabled />
          </Field>
          <Field label="Email">
            <input className={inputClass} value={user?.email ?? ""} disabled />
          </Field>
          <Field label="Role">
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink-700 dark:text-ink-200">
              <ShieldCheck size={14} className="text-primary-500" />
              {user ? (roleLabels[user.role] ?? user.role) : "—"}
            </div>
          </Field>
        </div>
      </Card>

      <div className="mt-5 flex justify-end">
        <SecondaryButton
          onClick={() => {
            signOut();
            navigate("/login");
          }}
          className="text-red-600 hover:border-red-300 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          <LogOut size={15} /> Log out
        </SecondaryButton>
      </div>
    </div>
  );
}
