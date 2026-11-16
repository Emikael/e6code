/**
 * Where the live canvas may run, and the one-canvas-per-window guard. Pure apart from the
 * module-level owner, so the gate is testable without a DOM.
 */
import type { MotionLevel } from "@e6tools/client-runtime/motion-level";
import type { AmbientStaticReason } from "@e6tools/shared/ambientLightState";

/**
 * The app surfaces allowed a live canvas (D12): the welcome wizard while it is open, and
 * pairing. The marketing hero uses the core directly. Zero-projects is never one: it renders
 * `AmbientStatic`.
 */
export const AMBIENT_SURFACES = ["welcome", "pairing"] as const;
export type AmbientSurface = (typeof AMBIENT_SURFACES)[number];

/** Mobile web keeps the static gradient, out of reach of mobile browsers' WebGL context caps. */
export const TOUCH_FIRST_QUERY = "(pointer: coarse) and (hover: none)";

export type AmbientGate =
  | { readonly live: true }
  | { readonly live: false; readonly reason: AmbientStaticReason };

export const decideAmbient = (input: {
  readonly level: MotionLevel;
  readonly surface: string;
  readonly touchFirst: boolean;
}): AmbientGate => {
  if (!(AMBIENT_SURFACES as ReadonlyArray<string>).includes(input.surface)) {
    return { live: false, reason: "surface-refused" };
  }
  if (input.level !== "full") return { live: false, reason: input.level };
  if (input.touchFirst) return { live: false, reason: "touch-first" };
  return { live: true };
};

let owner: symbol | null = null;

/**
 * Claims the window's one canvas. The first mounted surface keeps it; a second gets null and
 * shows the static gradient. Returns the release function.
 */
export const claimAmbientCanvas = (): (() => void) | null => {
  if (owner !== null) return null;
  const token = Symbol("ambient-canvas");
  owner = token;
  return () => {
    if (owner === token) owner = null;
  };
};
