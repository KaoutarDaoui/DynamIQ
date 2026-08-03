import { useLocation } from "react-router-dom";
import { Construction } from "lucide-react";
import { Card } from "../components/ui";

const titles: Record<string, string> = {
  maintenance: "Maintenance",
  thermal: "Thermal models",
  mpc: "MPC optimizer",
  diagnoses: "Diagnoses",
  admin: "Administration",
};

export default function ComingSoon() {
  const { pathname } = useLocation();
  const segment = pathname.split("/").filter(Boolean).at(-1) ?? "";
  const title = titles[segment] ?? "Module";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5">
        <h1 className="text-[20px] font-medium">{title}</h1>
        <p className="mt-1 text-[13px] text-ink-400">Deep-dive module for {title.toLowerCase()}.</p>
      </div>
      <Card className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-50 text-ink-400 dark:bg-ink-800">
          <Construction size={24} />
        </span>
        <p className="mt-4 text-[15px] font-medium">Coming soon</p>
        <p className="mt-1 max-w-sm text-[13px] text-ink-400">
          This module is being built. Check back soon, or use the audit log and reports in the meantime.
        </p>
      </Card>
    </div>
  );
}