import type { ReactNode } from "react";
import clsx from "clsx";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        "rounded-2xl bg-white border border-ink-100 shadow-sm dark:border-ink-800 dark:bg-ink-900",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between px-5 pt-5 pb-2">
      <div>
        <h3 className="text-[15px] font-medium text-ink-900 dark:text-white">{title}</h3>
        {subtitle && <p className="text-[13px] text-ink-400 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const statusStyles: Record<string, string> = {
  normal: "bg-teal-500/10 text-teal-700 border-teal-500/30 dark:text-teal-300",
  watch: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300",
  anomaly: "bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-300",
  online: "bg-teal-500/10 text-teal-700 border-teal-500/30 dark:text-teal-300",
  offline: "bg-ink-200/40 text-ink-600 border-ink-200 dark:bg-ink-800 dark:text-ink-400 dark:border-ink-700",
  maintenance: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300",
  open: "bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-300",
  diagnosing: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300",
  diagnosed: "bg-primary-500/10 text-primary-700 border-primary-500/30 dark:text-primary-300",
  resolved: "bg-teal-500/10 text-teal-700 border-teal-500/30 dark:text-teal-300",
  low: "bg-teal-500/10 text-teal-700 border-teal-500/30 dark:text-teal-300",
  medium: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300",
  high: "bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-300",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium capitalize",
        statusStyles[status] ?? "bg-ink-100 text-ink-600 border-ink-200 dark:bg-ink-800 dark:text-ink-400 dark:border-ink-700"
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label ?? status.replace("_", " ")}
    </span>
  );
}

export function StatCard({
  label,
  value,
  delta,
  positive = true,
  icon,
  accent = "bg-primary-50 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400",
}: {
  label: string;
  value: string;
  delta?: string;
  positive?: boolean;
  icon?: ReactNode;
  accent?: string;
}) {
  return (
    <Card className="p-5 border-primary-200 dark:border-primary-800">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-ink-400">{label}</p>
        {icon && (
          <span className={clsx("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", accent)}>{icon}</span>
        )}
      </div>
      <div className="mt-2 flex items-end justify-between">
        <span className="text-2xl font-medium text-ink-900 dark:text-white">{value}</span>
        {delta && (
          <span className={clsx("text-[12px] font-medium", positive ? "text-teal-700 dark:text-teal-300" : "text-red-700 dark:text-red-300")}>
            {delta}
          </span>
        )}
      </div>
    </Card>
  );
}

export function PrimaryButton({
  children,
  onClick,
  type = "button",
  className,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-xl bg-primary-500 px-4 py-2.5 text-[14px] font-medium text-white transition hover:bg-primary-600 active:bg-primary-700 dark:hover:bg-primary-400",
        disabled && "opacity-50 cursor-not-allowed hover:bg-primary-500 dark:hover:bg-primary-500",
        className
      )}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  className,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-xl border border-navy-200 bg-white px-4 py-2.5 text-[14px] font-medium text-navy-700 transition hover:border-navy-300 hover:bg-navy-50 dark:border-navy-700 dark:bg-ink-900 dark:text-navy-200 dark:hover:bg-navy-900/40",
        disabled && "opacity-50 cursor-not-allowed hover:border-navy-200 hover:bg-white dark:hover:bg-ink-900",
        className
      )}
    >
      {children}
    </button>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-ink-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[16px] font-medium text-ink-900 dark:text-white">{title}</h3>
        <div className="mt-2 text-[13px] text-ink-500 dark:text-ink-400">{message}</div>
        <div className="mt-5 flex justify-end gap-2">
          <SecondaryButton onClick={onCancel} disabled={loading}>
            Cancel
          </SecondaryButton>
          {danger ? (
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className={clsx(
                "inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-[14px] font-medium text-white transition hover:bg-red-700 active:bg-red-800 dark:hover:bg-red-500",
                loading && "opacity-50 cursor-not-allowed hover:bg-red-600 dark:hover:bg-red-600"
              )}
            >
              {loading ? "Deleting…" : confirmLabel}
            </button>
          ) : (
            <PrimaryButton onClick={onConfirm} disabled={loading}>
              {loading ? "Deleting…" : confirmLabel}
            </PrimaryButton>
          )}
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium text-ink-800 dark:text-ink-100">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-[12px] text-ink-400">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-[14px] text-ink-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100 dark:focus:ring-primary-900";