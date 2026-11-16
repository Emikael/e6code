/**
 * MotionPolicy's level (ENG-114), shared by web and mobile. Pure and Hermes-safe: each client
 * gathers its own device inputs and passes them in.
 */

/** Full plays everything; Reduced keeps short opacity fades only; Off changes state instantly. */
export type MotionLevel = "full" | "reduced" | "off";

/** The user's Motion setting. `system` (the default) follows the device. */
export type MotionPreference = "system" | "full" | "reduced" | "off";

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

const LOW_MEMORY_GB = 4;

const isConstrained = (constraints: MotionConstraints) =>
  constraints.prefersReducedMotion ||
  constraints.onBattery === true ||
  constraints.thermalState === "serious" ||
  constraints.thermalState === "critical" ||
  (constraints.deviceMemoryGb !== null && constraints.deviceMemoryGb <= LOW_MEMORY_GB);

/**
 * An explicit Full, Reduced or Off is final. Follow system drops to Reduced while any
 * constraint holds; nothing reaches Off without the user choosing it.
 */
export const resolveMotionLevel = (
  preference: MotionPreference | undefined,
  constraints: MotionConstraints,
): MotionLevel => {
  if (preference !== undefined && preference !== "system") return preference;
  return isConstrained(constraints) ? "reduced" : "full";
};
