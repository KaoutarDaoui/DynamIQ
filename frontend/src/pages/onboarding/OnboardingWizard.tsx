import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  UploadCloud,
  Loader2,
  AlertTriangle,
  FileText,
  DoorOpen,
  Wind,
} from "lucide-react";
import clsx from "clsx";
import {
  Card,
  Field,
  PrimaryButton,
  SecondaryButton,
  inputClass,
} from "../../components/ui";
import {
  ApiError,
  createBuilding,
  setRoomAirConditioners,
  uploadFloorPlan,
  type FloorUploadResponseDto,
  type NorthAngleDeg,
} from "../../lib/api";
import CompassDial from "./CompassDial";

const steps = [
  { id: 1, label: "Building" },
  { id: 2, label: "Floor plans" },
  { id: 3, label: "Done" },
];

interface FloorState {
  level: number;
  file: File | null;
  previewUrl: string | null;
  isPdf: boolean;
  north: NorthAngleDeg | null;
  analyzing: boolean;
  error: string | null;
  result: FloorUploadResponseDto | null;
}

function makeFloor(level: number): FloorState {
  return {
    level,
    file: null,
    previewUrl: null,
    isPdf: false,
    north: null,
    analyzing: false,
    error: null,
    result: null,
  };
}

interface AcRowState {
  count: number;
  capacityKw: number;
  saving: boolean;
  saved: boolean;
  error: string | null;
}

const DEFAULT_AC_ROW: AcRowState = {
  count: 0,
  capacityKw: 3.5,
  saving: false,
  saved: false,
  error: null,
};

export default function OnboardingWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // Step 1
  const [buildingName, setBuildingName] = useState("");
  const [address, setAddress] = useState("");
  const [floorCount, setFloorCount] = useState(2);
  const [creatingBuilding, setCreatingBuilding] = useState(false);
  const [buildingError, setBuildingError] = useState<string | null>(null);
  const [buildingId, setBuildingId] = useState<string | null>(null);

  // Step 2
  const [floors, setFloors] = useState<FloorState[]>([
    makeFloor(1),
    makeFloor(2),
  ]);
  const [currentFloorIndex, setCurrentFloorIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [acRows, setAcRows] = useState<Record<string, AcRowState>>({});

  function patchAcRow(roomId: string, patch: Partial<AcRowState>) {
    setAcRows((prev) => ({
      ...prev,
      [roomId]: { ...(prev[roomId] ?? DEFAULT_AC_ROW), ...patch },
    }));
  }

  async function saveAcRow(roomId: string) {
    const row = acRows[roomId] ?? DEFAULT_AC_ROW;
    patchAcRow(roomId, { saving: true, error: null, saved: false });
    try {
      await setRoomAirConditioners(roomId, row.count, row.capacityKw);
      patchAcRow(roomId, { saving: false, saved: true });
    } catch (err) {
      patchAcRow(roomId, {
        saving: false,
        error: err instanceof ApiError ? err.message : "Could not save.",
      });
    }
  }

  function updateFloorCount(n: number) {
    setFloorCount(n);
    setFloors((prev) => {
      const next = [...prev];
      while (next.length < n) next.push(makeFloor(next.length + 1));
      return next.slice(0, n);
    });
  }

  function patchCurrentFloor(patch: Partial<FloorState>) {
    setFloors((prev) =>
      prev.map((f, i) => (i === currentFloorIndex ? { ...f, ...patch } : f)),
    );
  }

  const currentFloor = floors[currentFloorIndex];

  useEffect(() => {
    // Revoke local object URLs on unmount so we don't leak blob refs.
    return () => {
      floors.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFileChosen(file: File) {
    if (currentFloor.previewUrl) URL.revokeObjectURL(currentFloor.previewUrl);
    const isPdf = file.type === "application/pdf";
    patchCurrentFloor({
      file,
      previewUrl: isPdf ? null : URL.createObjectURL(file),
      isPdf,
      north: null,
      error: null,
      result: null,
    });
  }

  async function analyzeCurrentFloor() {
    if (!buildingId || !currentFloor.file || currentFloor.north === null)
      return;
    patchCurrentFloor({ analyzing: true, error: null });
    try {
      const result = await uploadFloorPlan(
        buildingId,
        currentFloor.level,
        currentFloor.file,
        currentFloor.north,
      );
      patchCurrentFloor({ analyzing: false, result });
    } catch (err) {
      patchCurrentFloor({
        analyzing: false,
        error:
          err instanceof ApiError
            ? err.message
            : "Could not reach the backend.",
      });
    }
  }

  function goToNextFloor() {
    if (currentFloorIndex + 1 < floors.length) {
      setCurrentFloorIndex((i) => i + 1);
    } else {
      setStep(3);
    }
  }

  async function continueFromStep1() {
    setCreatingBuilding(true);
    setBuildingError(null);
    try {
      const building = await createBuilding({
        name: buildingName || "ESI Algiers",
        address: address || undefined,
        total_floors: floorCount,
      });
      setBuildingId(building.building_id);
      setStep(2);
    } catch (err) {
      setBuildingError(
        err instanceof ApiError ? err.message : "Could not reach the backend.",
      );
    } finally {
      setCreatingBuilding(false);
    }
  }

  const totalRoomsDetected = floors.reduce(
    (sum, f) => sum + (f.result?.rooms_saved ?? 0),
    0,
  );
  const floorsAnalyzed = floors.filter((f) => f.result).length;

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-center gap-2">
        <img src="/logo_dynamIQ_icon.png" alt="" className="h-8 w-8" />
        <img
          src="/logo_dynamIQ_name.png"
          alt="DynamIQ"
          className="h-8 w-auto"
        />
        <span className="text-[16px] font-medium text-ink-400">setup</span>
      </div>

      <ol className="mb-10 flex items-center">
        {steps.map((s, i) => (
          <li key={s.id} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={clsx(
                  "flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-medium",
                  step > s.id
                    ? "bg-teal-500 text-white"
                    : step === s.id
                      ? "bg-primary-500 text-white"
                      : "bg-ink-100 text-ink-400 dark:bg-ink-800 dark:text-ink-400",
                )}
              >
                {step > s.id ? <Check size={15} /> : s.id}
              </div>
              <span
                className={clsx(
                  "text-[11px]",
                  step === s.id
                    ? "font-medium text-ink-900 dark:text-ink-100"
                    : "text-ink-400",
                )}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={clsx(
                  "mx-2 h-px flex-1",
                  step > s.id ? "bg-teal-500" : "bg-ink-100 dark:bg-ink-800",
                )}
              />
            )}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <Card className="p-6">
          <h2 className="text-[17px] font-medium">New building</h2>
          <p className="mt-1 text-[13px] text-ink-400">
            Basic details, then tell us how many floors to onboard.
          </p>
          <div className="mt-6 flex flex-col gap-4">
            <Field label="Building name">
              <input
                className={inputClass}
                value={buildingName}
                onChange={(e) => setBuildingName(e.target.value)}
                placeholder="ESI Algiers"
              />
            </Field>
            <Field label="Address">
              <input
                className={inputClass}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Oued Smar, Algiers"
              />
            </Field>
            <Field
              label="How many floors?"
              hint="You'll upload and analyze each one on the next step."
            >
              <div className="flex items-center gap-3">
                <SecondaryButton
                  onClick={() => updateFloorCount(Math.max(1, floorCount - 1))}
                >
                  -
                </SecondaryButton>
                <span className="w-10 text-center text-[15px] font-medium">
                  {floorCount}
                </span>
                <SecondaryButton
                  onClick={() => updateFloorCount(Math.min(20, floorCount + 1))}
                >
                  +
                </SecondaryButton>
              </div>
            </Field>
          </div>
          {buildingError && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>{buildingError}</span>
            </div>
          )}
          <div className="mt-8 flex justify-end">
            <PrimaryButton
              onClick={continueFromStep1}
              className={clsx(
                creatingBuilding && "pointer-events-none opacity-60",
              )}
            >
              {creatingBuilding ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Creating…
                </>
              ) : (
                "Continue"
              )}
            </PrimaryButton>
          </div>
        </Card>
      )}

      {step === 2 && currentFloor && (
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[17px] font-medium">Floor plans</h2>
              <p className="mt-1 text-[13px] text-ink-400">
                Upload the plan, mark north, then analyze.
              </p>
            </div>
            <span className="rounded-full bg-ink-100 px-3 py-1 text-[12px] font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300">
              Floor {currentFloor.level} of {floors.length}
            </span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileChosen(file);
              e.target.value = "";
            }}
          />

          {!currentFloor.file ? (
            <div
              className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-ink-200 bg-ink-50 py-14 text-center transition hover:border-primary-300 dark:border-ink-700 dark:bg-ink-800/50"
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadCloud size={28} className="text-ink-400" />
              <p className="mt-3 text-[14px] font-medium text-ink-800 dark:text-ink-100">
                Click to choose a floor plan
              </p>
              <p className="mt-1 text-[12px] text-ink-400">
                PNG, JPG, WEBP, GIF or PDF
              </p>
            </div>
          ) : (
            <div className="mt-6">
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:justify-center">
                <div className="relative w-full max-w-md overflow-hidden rounded-xl border border-ink-100 bg-ink-50 dark:border-ink-800 dark:bg-ink-800/50">
                  {currentFloor.result?.annotated_plan_url ? (
                    <img
                      src={currentFloor.result.annotated_plan_url}
                      alt={`Floor ${currentFloor.level} annotated plan`}
                      className="w-full"
                    />
                  ) : currentFloor.isPdf ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-16">
                      <FileText size={28} className="text-ink-400" />
                      <p className="text-[13px] text-ink-500">
                        {currentFloor.file.name}
                      </p>
                    </div>
                  ) : (
                    currentFloor.previewUrl && (
                      <img
                        src={currentFloor.previewUrl}
                        alt={`Floor ${currentFloor.level} plan`}
                        className="w-full"
                      />
                    )
                  )}
                </div>

                {!currentFloor.result && (
                  <div className="flex shrink-0 flex-col items-center gap-2 rounded-xl border border-ink-100 p-4 dark:border-ink-800">
                    <p className="text-[12px] font-medium text-ink-600 dark:text-ink-300">
                      Which way is north?
                    </p>
                    <CompassDial
                      angleDeg={currentFloor.north}
                      onChange={(angle) => patchCurrentFloor({ north: angle })}
                    />
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between">
                <p className="text-[12px] text-ink-400">
                  {currentFloor.result
                    ? "Analyzed — room numbers shown on the plan."
                    : "Drag the compass so its needle points toward true north on the plan."}
                </p>
                {!currentFloor.result && (
                  <SecondaryButton
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <UploadCloud size={14} /> Replace
                  </SecondaryButton>
                )}
              </div>

              {currentFloor.error && (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <span>{currentFloor.error}</span>
                </div>
              )}

              {!currentFloor.result && (
                <div className="mt-4 flex justify-end">
                  <PrimaryButton
                    onClick={analyzeCurrentFloor}
                    className={clsx(
                      (currentFloor.north === null || currentFloor.analyzing) &&
                        "pointer-events-none opacity-40",
                    )}
                  >
                    {currentFloor.analyzing ? (
                      <>
                        <Loader2 size={15} className="animate-spin" />{" "}
                        Analyzing…
                      </>
                    ) : (
                      "Analyse"
                    )}
                  </PrimaryButton>
                </div>
              )}

              {currentFloor.result && (
                <div className="mt-5">
                  <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-ink-800 dark:text-ink-100">
                    <DoorOpen size={14} /> {currentFloor.result.rooms_saved}{" "}
                    room{currentFloor.result.rooms_saved === 1 ? "" : "s"}{" "}
                    detected
                    {currentFloor.result.rooms_flagged > 0 && (
                      <span className="ml-1 flex items-center gap-1 text-amber-700 dark:text-amber-400">
                        <AlertTriangle size={12} />
                        {currentFloor.result.rooms_flagged} need
                        {currentFloor.result.rooms_flagged === 1 ? "s" : ""}{" "}
                        review
                      </span>
                    )}
                  </p>
                  <div className="flex flex-col gap-2">
                    {currentFloor.result.rooms.map((room) => {
                      const ac = acRows[room.room_id] ?? DEFAULT_AC_ROW;
                      return (
                        <div
                          key={room.room_id}
                          className={clsx(
                            "rounded-xl border px-4 py-2.5",
                            room.needs_review
                              ? "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20"
                              : "border-ink-100 dark:border-ink-800",
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="flex items-center gap-1.5 text-[13px] font-medium">
                                {room.room_label}
                                {room.needs_review && (
                                  <span className="flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                                    <AlertTriangle size={10} /> Needs review
                                  </span>
                                )}
                              </p>
                              <p className="text-[11px] capitalize text-ink-400">
                                {room.room_type} · {room.primary_orientation}
                              </p>
                            </div>
                            <span className="text-[12px] font-medium text-ink-600 dark:text-ink-300">
                              {room.area_m2.toFixed(1)} m²
                            </span>
                          </div>

                          <div className="mt-2.5 flex items-center gap-2 border-t border-ink-100 pt-2.5 dark:border-ink-800">
                            <Wind size={13} className="shrink-0 text-ink-400" />
                            <input
                              type="number"
                              min={0}
                              max={20}
                              value={ac.count}
                              onChange={(e) =>
                                patchAcRow(room.room_id, {
                                  count: Number(e.target.value),
                                  saved: false,
                                })
                              }
                              className={clsx(
                                inputClass,
                                "w-16 px-2 py-1 text-[12px]",
                              )}
                              aria-label={`AC units in ${room.room_label}`}
                            />
                            <span className="text-[11px] text-ink-400">
                              units ×
                            </span>
                            <input
                              type="number"
                              min={0.1}
                              step={0.1}
                              value={ac.capacityKw}
                              onChange={(e) =>
                                patchAcRow(room.room_id, {
                                  capacityKw: Number(e.target.value),
                                  saved: false,
                                })
                              }
                              className={clsx(
                                inputClass,
                                "w-20 px-2 py-1 text-[12px]",
                              )}
                              aria-label={`AC capacity in ${room.room_label}`}
                            />
                            <span className="text-[11px] text-ink-400">
                              kW each
                            </span>
                            <button
                              type="button"
                              onClick={() => saveAcRow(room.room_id)}
                              disabled={ac.saving}
                              className={clsx(
                                "ml-auto flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition",
                                ac.saved
                                  ? "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
                                  : "bg-ink-100 text-ink-600 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-ink-700",
                              )}
                            >
                              {ac.saving ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : ac.saved ? (
                                <Check size={12} />
                              ) : null}
                              {ac.saving
                                ? "Saving…"
                                : ac.saved
                                  ? "Saved"
                                  : "Save"}
                            </button>
                          </div>
                          {ac.error && (
                            <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">
                              {ac.error}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-8 flex justify-between">
            <SecondaryButton onClick={() => setStep(1)}>Back</SecondaryButton>
            <PrimaryButton
              onClick={goToNextFloor}
              className={clsx(
                !currentFloor.result && "pointer-events-none opacity-40",
              )}
            >
              {currentFloorIndex + 1 < floors.length ? "Next floor" : "Finish"}
            </PrimaryButton>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card className="p-6">
          <h2 className="text-[17px] font-medium">All set</h2>
          <p className="mt-1 text-[13px] text-ink-400">
            Every uploaded floor is already saved — nothing left to confirm.
          </p>
          <dl className="mt-6 divide-y divide-ink-100 rounded-xl border border-ink-100 dark:divide-ink-800 dark:border-ink-800">
            {[
              ["Building", buildingName || "ESI Algiers"],
              ["Address", address || "—"],
              ["Floors analyzed", `${floorsAnalyzed} / ${floors.length}`],
              ["Rooms detected", String(totalRoomsDetected)],
            ].map(([k, v]) => (
              <div
                key={k}
                className="flex justify-between px-4 py-3 text-[14px]"
              >
                <dt className="text-ink-400">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-8 flex justify-end">
            <PrimaryButton onClick={() => navigate("/")}>
              Go to portfolio
            </PrimaryButton>
          </div>
        </Card>
      )}
    </div>
  );
}
