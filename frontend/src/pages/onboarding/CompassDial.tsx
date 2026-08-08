import { useCallback, useRef } from "react";
import clsx from "clsx";

const COMPASS_LABELS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const TICKS = [0, 45, 90, 135, 180, 225, 270, 315];

function nearestCompassLabel(angleDeg: number): string {
  const normalized = ((angleDeg % 360) + 360) % 360;
  return COMPASS_LABELS[Math.round(normalized / 45) % 8];
}

interface CompassDialProps {
  /** Clockwise degrees from "up" to true north. null = not set yet. */
  angleDeg: number | null;
  onChange: (angleDeg: number) => void;
  size?: number;
  className?: string;
}

/** Free-rotation compass: drag or click anywhere on the dial to set the exact
 * angle north points to on the plan, rather than snapping to 4 fixed arrows. */
export default function CompassDial({ angleDeg, onChange, size = 96, className }: CompassDialProps) {
  const dialRef = useRef<HTMLDivElement>(null);

  const angleFromPointer = useCallback((clientX: number, clientY: number): number => {
    const el = dialRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    // atan2(dx, -dy): 0deg = straight up, increasing clockwise — matches
    // the backend's north_angle_deg convention exactly.
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return ((deg % 360) + 360) % 360;
  }, []);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    onChange(angleFromPointer(e.clientX, e.clientY));
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.buttons !== 1) return;
    onChange(angleFromPointer(e.clientX, e.clientY));
  }

  const displayAngle = angleDeg ?? 0;
  const isSet = angleDeg !== null;

  return (
    <div className={clsx("flex flex-col items-center gap-1.5", className)}>
      <div
        ref={dialRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        style={{ width: size, height: size }}
        className={clsx(
          "relative cursor-grab touch-none select-none rounded-full border-2 bg-white shadow-sm active:cursor-grabbing dark:bg-ink-900",
          isSet ? "border-primary-400" : "border-ink-200 dark:border-ink-700"
        )}
        role="slider"
        aria-label="North direction"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(displayAngle)}
      >
        {TICKS.map((tick) => (
          <div
            key={tick}
            className="absolute left-1/2 top-1/2 h-1 w-1 rounded-full bg-ink-200 dark:bg-ink-700"
            style={{ transform: `rotate(${tick}deg) translateY(${-(size / 2 - 6)}px)` }}
          />
        ))}

        <div
          className="absolute inset-0"
          style={{ transform: `rotate(${displayAngle}deg)` }}
        >
          <div
            className={clsx("absolute left-1/2 top-1.5 w-1 -translate-x-1/2 rounded-full", isSet ? "bg-red-500" : "bg-ink-300 dark:bg-ink-600")}
            style={{ height: size * 0.36 }}
          />
        </div>

        <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-400 dark:bg-ink-500" />
      </div>
      <p className="text-[11px] font-medium text-ink-600 dark:text-ink-300">
        {isSet ? `${nearestCompassLabel(displayAngle)} · ${Math.round(displayAngle)}°` : "Drag to set north"}
      </p>
    </div>
  );
}
