/**
 * The ambient light (D12, ENG-132 and ENG-136): a WebGL2 canvas of slow light rays over a
 * static CSS gradient of the same composition. Framework-free, so the web app and the
 * marketing hero share it; the web mount lives in `apps/web/src/next/motion/ambient`.
 *
 * Why a canvas breaks "transform and opacity only": volumetric light needs per-pixel shading,
 * which no transform can draw. The budget that pays for it:
 * - allowed surfaces only (welcome and onboarding, pairing, the marketing hero), one canvas
 *   per window, and never behind a working screen;
 * - 30 fps, half resolution of a device pixel ratio capped at 1.5, shader under 8 KB;
 * - frames only during the 2.4 s intro and within 10 s of input, and none while the page is
 *   hidden, blurred, off screen or streaming, or when MotionPolicy is not Full.
 * GPU time per frame is not measured yet (no E05 harness).
 */
import { EASE_BEZIER } from "@e6tools/design-tokens/motion";

import { type AmbientClock, type AmbientPauseReason, createFrameLoop } from "./frameLoop.ts";
import {
  type AmbientCanvas,
  type AmbientColors,
  type AmbientRenderer,
  createAmbientRenderer,
} from "./renderer.ts";

export { AMBIENT_FRAME_MS, AMBIENT_IDLE_MS } from "./frameLoop.ts";
export type { AmbientClock, AmbientPauseReason } from "./frameLoop.ts";
export { AMBIENT_CONTEXT_ATTRIBUTES } from "./renderer.ts";
export type { AmbientCanvas, AmbientColors } from "./renderer.ts";

/** The intro: brightness and canvas opacity rise over this long, at Full only, once. */
export const AMBIENT_INTRO_MS = 2400;
/** Shader brightness at the start of the intro. */
const INTRO_GAIN_FROM = 0.55;
/** Device pixel ratio cap; the buffer is then halved and scaled up by CSS (ENG-136). */
export const AMBIENT_MAX_DPR = 1.5;
export const AMBIENT_RESOLUTION_SCALE = 0.5;

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
  | { readonly kind: "static"; readonly reason: AmbientStaticReason }
  | { readonly kind: "running"; readonly intro: boolean }
  | { readonly kind: "paused"; readonly reasons: ReadonlyArray<AmbientPauseReason> };

/** Static states the canvas cannot leave without a remount. */
export const isTerminalAmbientState = (state: AmbientState): boolean =>
  state.kind === "static" && state.reason !== "context-lost";

/** One axis of the drawing buffer, in device pixels. */
export const ambientBufferSize = (cssPixels: number, devicePixelRatio: number): number =>
  Math.max(
    1,
    Math.round(cssPixels * Math.min(devicePixelRatio, AMBIENT_MAX_DPR) * AMBIENT_RESOLUTION_SCALE),
  );

export interface AmbientLightOptions {
  readonly canvas: AmbientCanvas;
  readonly clock: AmbientClock;
  readonly colors: AmbientColors;
  /** False when this mount already played the intro: no replay after a policy flip. */
  readonly playIntro: boolean;
  readonly onState: (state: AmbientState) => void;
  /**
   * Eased intro progress, 0 to 1, once per drawn intro frame and then never again. The host
   * writes it as the canvas opacity and its inverse as the static rays' opacity.
   */
  readonly onIntro: (progress: number) => void;
}

export interface AmbientLight {
  readonly setPaused: (reason: Exclude<AmbientPauseReason, "idle">, paused: boolean) => void;
  readonly input: () => void;
  /** CSS size and device pixel ratio; draws one frame when the loop is not running. */
  readonly resize: (cssWidth: number, cssHeight: number, devicePixelRatio: number) => void;
  /** Draws one frame when the loop is not running, so a paused light follows the theme. */
  readonly setColors: (colors: AmbientColors) => void;
  readonly getState: () => AmbientState;
  /** Stops frames and releases the context. Safe to call twice. */
  readonly destroy: () => void;
}

/** Starts the light, or returns the static reason when WebGL2 or the shader is unavailable. */
export const createAmbientLight = (
  options: AmbientLightOptions,
): AmbientLight | { readonly static: AmbientStaticReason } => {
  const { canvas, clock, onState, onIntro } = options;
  const start = createAmbientRenderer(canvas);
  if (!start.ok) return { static: start.reason };

  let renderer: AmbientRenderer | null = start.renderer;
  let colors = options.colors;
  let introActive = true;
  let losses = 0;
  let terminal: AmbientStaticReason | null = null;
  let contextLost = false;
  let state: AmbientState = { kind: "running", intro: options.playIntro };
  const ease = cubicBezier(EASE_BEZIER.enter);

  const draw = (timeMs: number): boolean => {
    if (renderer === null) return false;
    const progress = !options.playIntro ? 1 : Math.min(timeMs / AMBIENT_INTRO_MS, 1);
    const eased = progress >= 1 ? 1 : ease(progress);
    const result = renderer.draw(
      { timeSeconds: timeMs / 1000, gain: INTRO_GAIN_FROM + (1 - INTRO_GAIN_FROM) * eased },
      colors,
    );
    if (result === "failed") {
      fail("shader-failed");
      return false;
    }
    if (result === "pending") return false;
    if (introActive) {
      onIntro(eased);
      if (eased >= 1) {
        introActive = false;
        emit();
      }
    }
    return true;
  };

  const loop = createFrameLoop({ clock, draw, onChange: () => emit() });

  const computeState = (): AmbientState => {
    if (terminal !== null) return { kind: "static", reason: terminal };
    if (contextLost) return { kind: "static", reason: "context-lost" };
    const reasons = loop.pauseReasons();
    if (reasons.length > 0) return { kind: "paused", reasons };
    return { kind: "running", intro: introActive && options.playIntro };
  };

  function emit() {
    const next = computeState();
    if (sameState(next, state)) return;
    state = next;
    onState(state);
  }

  const onLost = (event: Event) => {
    // Without preventDefault the browser never offers a restore.
    event.preventDefault();
    losses += 1;
    if (losses >= 2) {
      fail("context-lost-twice");
      return;
    }
    contextLost = true;
    loop.suspend(true);
    emit();
  };

  const onRestored = () => {
    if (renderer === null || terminal !== null) return;
    if (!renderer.restore()) {
      fail("shader-failed");
      return;
    }
    contextLost = false;
    loop.drawNow();
    // Resumes only when no pause reason holds.
    loop.suspend(false);
    emit();
  };

  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  const teardown = () => {
    // Listeners go first: releasing the context fires `webglcontextlost`, which must not
    // count as a loss.
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
    loop.destroy();
    renderer?.release();
    renderer = null;
  };

  function fail(reason: AmbientStaticReason) {
    if (terminal !== null) return;
    terminal = reason;
    teardown();
    emit();
  }

  const redrawIfIdle = () => {
    if (!loop.isRunning()) loop.drawNow();
  };

  return {
    setPaused: loop.setPaused,
    input: loop.input,
    resize: (cssWidth, cssHeight, devicePixelRatio) => {
      if (renderer === null) return;
      renderer.resize(
        ambientBufferSize(cssWidth, devicePixelRatio),
        ambientBufferSize(cssHeight, devicePixelRatio),
      );
      // A resize clears the buffer (`preserveDrawingBuffer: false`), so a paused light
      // redraws its current frame once.
      redrawIfIdle();
    },
    setColors: (next) => {
      colors = next;
      redrawIfIdle();
    },
    getState: () => state,
    destroy: teardown,
  };
};

const sameState = (a: AmbientState, b: AmbientState): boolean => {
  if (a.kind === "static" && b.kind === "static") return a.reason === b.reason;
  if (a.kind === "running" && b.kind === "running") return a.intro === b.intro;
  if (a.kind === "paused" && b.kind === "paused") {
    return a.reasons.length === b.reasons.length && a.reasons.every((r) => b.reasons.includes(r));
  }
  return false;
};

/** A CSS `cubic-bezier()` as a function of progress, solved for x by bisection. */
export const cubicBezier = ([x1, y1, x2, y2]: readonly [number, number, number, number]) => {
  const axis = (a: number, b: number, t: number) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let low = 0;
    let high = 1;
    let t = x;
    for (let i = 0; i < 24; i += 1) {
      t = (low + high) / 2;
      if (axis(x1, x2, t) < x) low = t;
      else high = t;
    }
    return axis(y1, y2, t);
  };
};

const PAUSE_WORDS: Record<AmbientPauseReason, string> = {
  hidden: "tab hidden",
  blurred: "window blurred",
  offscreen: "off-screen",
  idle: "10 s without input",
  streaming: "focused thread streaming",
};

const STATIC_WORDS: Record<AmbientStaticReason, string> = {
  reduced: "Motion is Reduced",
  off: "Motion is Off",
  "no-webgl2": "No WebGL2",
  "shader-failed": "Shader failed to compile",
  "context-lost": "Context lost: waiting for restore",
  "context-lost-twice": "Context lost twice: static until remount",
  "touch-first": "Touch-first device (mobile web)",
  "surface-refused": "Surface is not allowed",
  "canvas-in-use": "Renderer is on another surface",
};

/** The design's readout strings (ENG-136 section 4), for debug attributes and tests. */
export const describeAmbientState = (state: AmbientState): string => {
  switch (state.kind) {
    case "running":
      return state.intro ? "Running: 2.4 s intro" : "Running: slow drift, 30 fps";
    case "paused":
      return `Paused on current frame: ${state.reasons.map((r) => PAUSE_WORDS[r]).join(", ")}`;
    case "static":
      return `Static gradient: ${STATIC_WORDS[state.reason]}`;
  }
};

/** The browser inputs that pause the light; each is optional so a host can omit one. */
export interface AmbientHost {
  readonly document: Pick<
    Document,
    "hidden" | "hasFocus" | "addEventListener" | "removeEventListener"
  >;
  readonly window: Pick<Window, "addEventListener" | "removeEventListener" | "devicePixelRatio">;
  /** The positioned box the canvas fills. */
  readonly element: Element;
  readonly IntersectionObserver?: typeof IntersectionObserver;
  readonly ResizeObserver?: typeof ResizeObserver;
}

const INPUT_EVENTS = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const;

/**
 * Wires visibility, focus, intersection, size and input to the light. Input listeners are
 * passive and only record a time; the frame loop checks idle, so no idle timer exists.
 * Returns the unbind function.
 */
export const bindAmbientHost = (light: AmbientLight, host: AmbientHost): (() => void) => {
  const { document, window, element } = host;
  const cleanups: Array<() => void> = [];
  const listen = <Target extends Pick<EventTarget, "addEventListener" | "removeEventListener">>(
    target: Target,
    type: string,
    listener: () => void,
    options?: AddEventListenerOptions,
  ) => {
    target.addEventListener(type, listener, options);
    cleanups.push(() => target.removeEventListener(type, listener, options));
  };

  const syncHidden = () => light.setPaused("hidden", document.hidden);
  syncHidden();
  listen(document, "visibilitychange", syncHidden);

  light.setPaused("blurred", !document.hasFocus());
  listen(window, "blur", () => light.setPaused("blurred", true));
  listen(window, "focus", () => light.setPaused("blurred", false));

  for (const type of INPUT_EVENTS) listen(window, type, light.input, { passive: true });

  if (host.IntersectionObserver !== undefined) {
    const observer = new host.IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (entry !== undefined) light.setPaused("offscreen", !entry.isIntersecting);
    });
    observer.observe(element);
    cleanups.push(() => observer.disconnect());
  }

  const resize = () =>
    light.resize(element.clientWidth, element.clientHeight, window.devicePixelRatio || 1);
  resize();
  if (host.ResizeObserver !== undefined) {
    const observer = new host.ResizeObserver(resize);
    observer.observe(element);
    cleanups.push(() => observer.disconnect());
  }

  return () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  };
};
