/**
 * The ambient light's states and their readout strings. Its own module, with no WebGL code,
 * so a host can name and describe states without loading the renderer.
 */

/** Reasons the loop stops on its current frame (ENG-132). `idle` is the loop's own. */
export type AmbientPauseReason = "hidden" | "blurred" | "offscreen" | "idle" | "streaming";

/** Why the static gradient shows instead of the canvas. */
export type AmbientStaticReason =
  | "reduced"
  | "off"
  | "no-webgl2"
  | "shader-failed"
  | "context-lost"
  | "context-lost-twice"
  | "touch-first"
  | "surface-refused"
  | "canvas-in-use";

export type AmbientState =
  | {
      readonly kind: "static";
      readonly reason: AmbientStaticReason;
      /** The refused surface for `surface-refused`; the owner's name for `canvas-in-use`. */
      readonly detail?: string;
    }
  | { readonly kind: "running"; readonly intro: boolean }
  | { readonly kind: "paused"; readonly reasons: ReadonlyArray<AmbientPauseReason> };

/** Static states the canvas cannot leave without a remount. */
export const isTerminalAmbientState = (state: AmbientState): boolean =>
  state.kind === "static" && state.reason !== "context-lost";

const PAUSE_WORDS: Record<AmbientPauseReason, string> = {
  hidden: "tab hidden",
  blurred: "window blurred",
  offscreen: "off-screen",
  idle: "10 s without input",
  streaming: "focused thread streaming",
};

const STATIC_WORDS: Record<
  Exclude<AmbientStaticReason, "surface-refused" | "canvas-in-use">,
  string
> = {
  reduced: "Motion is Reduced",
  off: "Motion is Off",
  "no-webgl2": "No WebGL2",
  "shader-failed": "Shader failed to compile",
  "context-lost": "Context lost: waiting for restore",
  "context-lost-twice": "Context lost twice: static until remount",
  "touch-first": "Touch-first device (mobile web)",
};

/** The design's readout strings (ENG-136 section 4), for debug attributes and tests. */
export const describeAmbientState = (state: AmbientState): string => {
  switch (state.kind) {
    case "running":
      return state.intro ? "Running: 2.4 s intro" : "Running: slow drift, 30 fps";
    case "paused":
      return `Paused on current frame: ${state.reasons.map((r) => PAUSE_WORDS[r]).join(", ")}`;
    case "static":
      // The spec's refused-mount and badge strings, which do not start "Static gradient:".
      if (state.reason === "surface-refused") {
        return `Refused: ${state.detail ?? "this surface"} is not an allowed surface, it keeps the static gradient`;
      }
      if (state.reason === "canvas-in-use") {
        return `Static: renderer is on ${state.detail ?? "another surface"}`;
      }
      return `Static gradient: ${STATIC_WORDS[state.reason]}`;
  }
};
