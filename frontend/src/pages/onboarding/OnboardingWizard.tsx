import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, UploadCloud, Zap, Loader2, Sparkles } from "lucide-react";
import clsx from "clsx";
import { Card, Field, PrimaryButton, SecondaryButton, inputClass } from "../../components/ui";

const steps = [
  { id: 1, label: "Building" },
  { id: 2, label: "Floor plans" },
  { id: 3, label: "Room details" },
  { id: 4, label: "Agent analysis" },
  { id: 5, label: "Review & save" },
];

interface FloorDraft {
  level: number;
  label: string;
  fileName: string | null;
}

export default function OnboardingWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [buildingName, setBuildingName] = useState("");
  const [address, setAddress] = useState("");
  const [floorCount, setFloorCount] = useState(2);
  const [floorDrafts, setFloorDrafts] = useState<FloorDraft[]>([
    { level: 1, label: "Floor 1", fileName: null },
    { level: 2, label: "Floor 2", fileName: null },
  ]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);

  function updateFloorCount(n: number) {
    setFloorCount(n);
    setFloorDrafts((prev) => {
      const next = [...prev];
      while (next.length < n) next.push({ level: next.length + 1, label: `Floor ${next.length + 1}`, fileName: null });
      return next.slice(0, n);
    });
  }

  function runAnalysis() {
    setAnalyzing(true);
    setTimeout(() => {
      setAnalyzing(false);
      setAnalyzed(true);
    }, 1800);
  }

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500 text-white">
          <Zap size={16} />
        </span>
        <span className="text-[16px] font-medium">DynamIQ setup</span>
      </div>

      <ol className="mb-10 flex items-center">
        {steps.map((s, i) => (
          <li key={s.id} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={clsx(
                  "flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-medium",
                  step > s.id ? "bg-teal-500 text-white" : step === s.id ? "bg-primary-500 text-white" : "bg-ink-100 text-ink-400 dark:bg-ink-800 dark:text-ink-400"
                )}
              >
                {step > s.id ? <Check size={15} /> : s.id}
              </div>
              <span className={clsx("text-[11px]", step === s.id ? "font-medium text-ink-900 dark:text-ink-100" : "text-ink-400")}>{s.label}</span>
            </div>
            {i < steps.length - 1 && <div className={clsx("mx-2 h-px flex-1", step > s.id ? "bg-teal-500" : "bg-ink-100 dark:bg-ink-800")} />}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <Card className="p-6">
          <h2 className="text-[17px] font-medium">New building</h2>
          <p className="mt-1 text-[13px] text-ink-400">Basic details, then tell us how many floors to onboard.</p>
          <div className="mt-6 flex flex-col gap-4">
            <Field label="Building name">
              <input className={inputClass} value={buildingName} onChange={(e) => setBuildingName(e.target.value)} placeholder="ESI Algiers" />
            </Field>
            <Field label="Address">
              <input className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Oued Smar, Algiers" />
            </Field>
            <Field label="How many floors?" hint="You can add more later from settings.">
              <div className="flex items-center gap-3">
                <SecondaryButton onClick={() => updateFloorCount(Math.max(1, floorCount - 1))}>-</SecondaryButton>
                <span className="w-10 text-center text-[15px] font-medium">{floorCount}</span>
                <SecondaryButton onClick={() => updateFloorCount(Math.min(20, floorCount + 1))}>+</SecondaryButton>
              </div>
            </Field>
          </div>
          <div className="mt-8 flex justify-end">
            <PrimaryButton onClick={() => setStep(2)}>Continue</PrimaryButton>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card className="p-6">
          <h2 className="text-[17px] font-medium">Floor plans</h2>
          <p className="mt-1 text-[13px] text-ink-400">Upload one image per floor. Agent 1 will read walls, windows and orientation from it.</p>
          <div className="mt-6 flex flex-col gap-3">
            {floorDrafts.map((f, i) => (
              <div key={f.level} className="flex items-center justify-between rounded-xl border border-ink-100 px-4 py-3 dark:border-ink-800">
                <div>
                  <p className="text-[14px] font-medium">{f.label}</p>
                  <p className="text-[12px] text-ink-400">{f.fileName ?? "No file uploaded"}</p>
                </div>
                <SecondaryButton
                  onClick={() =>
                    setFloorDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, fileName: `floor-${f.level}-plan.png` } : d)))
                  }
                >
                  <UploadCloud size={15} /> {f.fileName ? "Replace" : "Upload"}
                </SecondaryButton>
              </div>
            ))}
          </div>
          <div className="mt-8 flex justify-between">
            <SecondaryButton onClick={() => setStep(1)}>Back</SecondaryButton>
            <PrimaryButton onClick={() => setStep(3)}>Continue</PrimaryButton>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card className="p-6">
          <h2 className="text-[17px] font-medium">Room details</h2>
          <p className="mt-1 text-[13px] text-ink-400">Mark rooms on each plan and assign an AC unit. You can fine-tune envelope details after analysis.</p>
          <div className="mt-6 rounded-xl border border-dashed border-ink-200 bg-ink-50 p-10 text-center dark:border-ink-700 dark:bg-ink-800/50">
            <p className="text-[13px] text-ink-400">Interactive plan annotator renders here — click a wall to draw a room, then assign its AC unit ID.</p>
          </div>
          <div className="mt-6 flex flex-col gap-3">
            {["Salle 101", "Salle 102", "Salle 103", "Salle 104"].map((r, i) => (
              <div key={r} className="flex items-center justify-between rounded-xl border border-ink-100 px-4 py-3 dark:border-ink-800">
                <span className="text-[14px] font-medium">{r}</span>
                <input className={clsx(inputClass, "w-40")} defaultValue={`AC-10${i + 1}-A`} />
              </div>
            ))}
          </div>
          <div className="mt-8 flex justify-between">
            <SecondaryButton onClick={() => setStep(2)}>Back</SecondaryButton>
            <PrimaryButton onClick={() => setStep(4)}>Continue</PrimaryButton>
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card className="p-6">
          <h2 className="text-[17px] font-medium">Agent analysis</h2>
          <p className="mt-1 text-[13px] text-ink-400">Agent 1 extracts geometry, R/C parameters and adjacency, then hands off to Agent 2.</p>
          <div className="mt-8 flex flex-col items-center justify-center rounded-xl border border-ink-100 bg-ink-50 py-14 dark:border-ink-800 dark:bg-ink-800/50">
            {!analyzing && !analyzed && (
              <>
                <Sparkles className="text-primary-500" size={28} />
                <p className="mt-3 text-[14px] text-ink-600">Ready to analyze 4 floor plans and 42 rooms.</p>
                <PrimaryButton className="mt-5" onClick={runAnalysis}>
                  Start analysis
                </PrimaryButton>
              </>
            )}
            {analyzing && (
              <>
                <Loader2 className="animate-spin text-primary-500" size={28} />
                <p className="mt-3 text-[14px] text-ink-600">Extracting envelope, R/C parameters and adjacency…</p>
              </>
            )}
            {analyzed && (
              <>
                <Check className="text-teal-500" size={28} />
                <p className="mt-3 text-[14px] font-medium text-ink-900 dark:text-ink-100">Analysis complete</p>
                <p className="text-[13px] text-ink-400">42 rooms processed, 0 warnings, ready to save.</p>
              </>
            )}
          </div>
          <div className="mt-8 flex justify-between">
            <SecondaryButton onClick={() => setStep(3)}>Back</SecondaryButton>
            <PrimaryButton onClick={() => setStep(5)} className={clsx(!analyzed && "pointer-events-none opacity-40")}>
              Continue
            </PrimaryButton>
          </div>
        </Card>
      )}

      {step === 5 && (
        <Card className="p-6">
          <h2 className="text-[17px] font-medium">Review & save</h2>
          <p className="mt-1 text-[13px] text-ink-400">Confirm details before persisting to Supabase.</p>
          <dl className="mt-6 divide-y divide-ink-100 rounded-xl border border-ink-100 dark:divide-ink-800 dark:border-ink-800">
            {[
              ["Building", buildingName || "ESI Algiers"],
              ["Address", address || "Oued Smar, Algiers"],
              ["Floors", String(floorCount)],
              ["Rooms detected", "42"],
              ["Agent 1 status", "Complete"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between px-4 py-3 text-[14px]">
                <dt className="text-ink-400">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-8 flex justify-between">
            <SecondaryButton onClick={() => setStep(4)}>Back</SecondaryButton>
            <PrimaryButton onClick={() => navigate("/b/esi-algiers")}>Save building</PrimaryButton>
          </div>
        </Card>
      )}
    </div>
  );
}