const QUIT_HOLD_DRAIN_MS = 200;

/** X scale from a computed transform. `getComputedStyle` returns a matrix; a raw `scaleX()` is accepted too. */
export function scaleXFromTransform(transform: string): number {
  if (transform.length === 0 || transform === "none") return 0;
  const matrix = /matrix(?:3d)?\(\s*(-?[\d.]+)/.exec(transform);
  const scale = matrix?.[1] ?? /scaleX\(\s*(-?[\d.]+)/.exec(transform)?.[1];
  const value = scale === undefined ? Number.NaN : Number(scale);
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export type QuitHoldFillMotion =
  | { readonly kind: "freeze"; readonly scale: number }
  | { readonly kind: "fill"; readonly from: 0; readonly to: 1; readonly duration: number }
  | { readonly kind: "drain"; readonly from: number; readonly to: 0; readonly duration: number };

/**
 * The fill is the hold's progress. A press runs empty to full over the desktop
 * hold. A release drains from the scale already reached, as an explicit from
 * keyframe, so replacing the in-flight animation cannot jump to the end.
 * Reduced motion keeps whatever scale is already showing.
 */
export function quitHoldFillMotion(input: {
  readonly holding: boolean;
  readonly reducedMotion: boolean;
  readonly currentScale: number;
  readonly holdDurationMs: number;
}): QuitHoldFillMotion {
  const scale = scaleXFromTransform(`scaleX(${input.currentScale})`);
  if (input.reducedMotion) return { kind: "freeze", scale };
  if (input.holding) return { kind: "fill", from: 0, to: 1, duration: input.holdDurationMs };
  return { kind: "drain", from: scale, to: 0, duration: QUIT_HOLD_DRAIN_MS };
}
