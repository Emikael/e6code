/**
 * MotionPolicy's level (ENG-114), shared by web and mobile. Pure and Hermes-safe: each client
 * gathers its own device inputs and passes them in.
 */
import type { MotionPreference } from "@e6tools/contracts/settings";

/** Full plays everything; Reduced keeps short opacity fades only; Off changes state instantly. */
export type MotionLevel = "full" | "reduced" | "off";

/** The user's Motion setting, as stored in client settings. `system` (the default) follows the device. */
export type { MotionPreference };

/** Electron's thermal states; other clients report `unknown`. */
export type MotionThermalState = "unknown" | "nominal" | "fair" | "serious" | "critical";

export interface MotionConstraints {
  readonly prefersReducedMotion: boolean;
  /** `null` when the client cannot tell, which counts as not on battery. */
  readonly onBattery: boolean | null;
  readonly thermalState: MotionThermalState;
  /** Device memory in GB as the platform reports it; `null` when unknown. */
  readonly deviceMemoryGb: number | null;
}

/** Why the device asks for less motion, in the order the Motion setting lists them. */
export type MotionConstraintReason = "reduced-motion" | "battery" | "thermal" | "memory";

const LOW_MEMORY_GB = 4;

/** Every constraint that currently holds, in display order. */
export const activeMotionConstraints = (
  constraints: MotionConstraints,
): ReadonlyArray<MotionConstraintReason> => {
  const reasons: Array<MotionConstraintReason> = [];
  if (constraints.prefersReducedMotion) reasons.push("reduced-motion");
  if (constraints.onBattery === true) reasons.push("battery");
  if (constraints.thermalState === "serious" || constraints.thermalState === "critical") {
    reasons.push("thermal");
  }
  if (constraints.deviceMemoryGb !== null && constraints.deviceMemoryGb <= LOW_MEMORY_GB) {
    reasons.push("memory");
  }
  return reasons;
};

/**
 * An explicit Full, Reduced or Off is final. Follow system drops to Reduced while any
 * constraint holds; nothing reaches Off without the user choosing it.
 */
export const resolveMotionLevel = (
  preference: MotionPreference | undefined,
  constraints: MotionConstraints,
): MotionLevel => {
  if (preference !== undefined && preference !== "system") return preference;
  return activeMotionConstraints(constraints).length > 0 ? "reduced" : "full";
};

/** The Motion setting's choices in display order, with the copy every client shows. */
export const MOTION_PREFERENCE_OPTIONS: ReadonlyArray<{
  readonly value: MotionPreference;
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: "system",
    label: "Follow system",
    description: "Full, or Reduced when your device asks for less",
  },
  { value: "full", label: "Full", description: "Every transition" },
  { value: "reduced", label: "Reduced", description: "Short fades, nothing travels" },
  { value: "off", label: "Off", description: "Changes happen instantly" },
];

const REASON_TEXT: Record<MotionConstraintReason, string> = {
  "reduced-motion": "reduced motion is on",
  battery: "on battery",
  thermal: "running hot",
  memory: "low memory",
};

const joinReasons = (reasons: ReadonlyArray<MotionConstraintReason>) => {
  const words = reasons.map((reason) => REASON_TEXT[reason]);
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
};

/**
 * The line under the Motion control that says what Follow system resolved to and why, or
 * that an explicit Full overrides the device. `null` when there is nothing to explain.
 */
export const describeMotionResolution = (
  preference: MotionPreference,
  reasons: ReadonlyArray<MotionConstraintReason>,
): string | null => {
  switch (preference) {
    case "system":
      return reasons.length === 0
        ? "Following system: Full"
        : `Following system: Reduced, ${joinReasons(reasons)}`;
    case "full":
      return reasons.length === 0
        ? null
        : `Full, even though your device reports ${joinReasons(reasons)}`;
    case "reduced":
    case "off":
      return null;
  }
};
