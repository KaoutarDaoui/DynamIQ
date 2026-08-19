import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, Zap } from "lucide-react";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Field, PrimaryButton, inputClass } from "../components/ui";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    signIn(email, password)
      .then(() => {
        const redirectTo = (location.state as { from?: string } | null)?.from ?? "/";
        navigate(redirectTo, { replace: true });
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Could not reach the server.");
      })
      .finally(() => setSubmitting(false));
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f4f1] px-4 dark:bg-[#161512]">
      <div className="w-full max-w-sm rounded-2xl border border-ink-100 bg-white p-8 shadow-sm dark:border-ink-800 dark:bg-ink-900">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-500 text-white">
            <Zap size={18} />
          </span>
          <span className="text-[18px] font-medium">DynamIQ</span>
        </div>
        <h1 className="text-[20px] font-medium">Sign in</h1>
        <p className="mt-1 text-[13px] text-ink-400">Predictive HVAC control for your building.</p>

        <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
          <Field label="Email">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="you@company.com"
              autoComplete="email"
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </Field>
          {error && (
            <p className="flex items-center gap-1.5 text-[13px] text-red-600 dark:text-red-400">
              <AlertTriangle size={14} /> {error}
            </p>
          )}
          <PrimaryButton type="submit" className={`mt-2 w-full ${submitting ? "pointer-events-none opacity-50" : ""}`}>
            {submitting ? "Signing in…" : "Sign in"}
          </PrimaryButton>
        </form>

        <p className="mt-6 text-center text-[13px] text-ink-400">
          Invited by your facility manager?{" "}
          <span className="font-medium text-primary-600 dark:text-primary-400">Accept invite</span>
        </p>
      </div>
    </div>
  );
}