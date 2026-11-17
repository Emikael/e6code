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

/** The names the spec's readout uses for each surface. */
const SURFACE_LABELS: Readonly<Record<AmbientSurface, string>> = {
  welcome: "Welcome",
  pairing: "Pairing",
};

export type AmbientGate =
  | { readonly live: true }
  | { readonly live: false; readonly reason: AmbientStaticReason; readonly detail?: string };

export const decideAmbient = (input: {
  readonly level: MotionLevel;
  readonly surface: string;
  readonly touchFirst: boolean;
}): AmbientGate => {
  if (!(AMBIENT_SURFACES as ReadonlyArray<string>).includes(input.surface)) {
    return { live: false, reason: "surface-refused", detail: input.surface };
  }
  if (input.level !== "full") return { live: false, reason: input.level };
  if (input.touchFirst) return { live: false, reason: "touch-first" };
  return { live: true };
};

let owner: { readonly token: symbol; readonly surface: AmbientSurface } | null = null;

export type AmbientClaim =
  | { readonly release: () => void }
  /** Another surface holds the canvas; its readout name. */
  | { readonly heldBy: string };

/**
 * Claims the window's one canvas. The first mounted surface keeps it; a second is told who
 * holds it and shows the static gradient.
 */
export const claimAmbientCanvas = (surface: AmbientSurface): AmbientClaim => {
  if (owner !== null) return { heldBy: SURFACE_LABELS[owner.surface] };
  const token = Symbol("ambient-canvas");
  owner = { token, surface };
  return {
    release: () => {
      if (owner?.token === token) owner = null;
    },
  };
};
