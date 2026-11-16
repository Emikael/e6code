/**
 * The ambient light's frame loop: a 30 fps cap over `requestAnimationFrame`, an idle stop
 * after 10 s without input, and pause reasons that stop frames without losing the frame's
 * time. Framework-free and global-free: the clock and the frame scheduler are injected.
 */
import type { AmbientPauseReason } from "./state.ts";

/** Draws are paced to this interval, whatever the display's refresh rate. */
const AMBIENT_FRAME_MS = 1000 / 30;
/** The loop rests after this long without input, and any input wakes it. */
export const AMBIENT_IDLE_MS = 10_000;
/** Callbacks this early still draw, so 33.2 ms after the last draw does not wait a frame. */
const FRAME_SLACK_MS = 2;
/** A stalled frame advances the light by at most this much, so it never jumps. */
const MAX_STEP_MS = 100;

export interface AmbientClock {
  /** Same time base as the frame callback's timestamp (`performance.now()` in a browser). */
  readonly now: () => number;
  readonly requestFrame: (callback: (time: number) => void) => number;
  readonly cancelFrame: (handle: number) => void;
}

export interface FrameLoop {
  /** Adds or clears a pause reason; clearing the last one resumes from the frozen time. */
  readonly setPaused: (reason: Exclude<AmbientPauseReason, "idle">, paused: boolean) => void;
  /** Records input; wakes the loop when idle was its only reason to rest. */
  readonly input: () => void;
  /** Held while the context is lost: no frames, without counting as a pause reason. */
  readonly suspend: (suspended: boolean) => void;
  /** Draws one frame at the current time, running or not (resize, colours). */
  readonly drawNow: () => void;
  /**
   * Draws one frame at the current time as soon as the renderer can (a restored context may
   * still be compiling), then calls `onDrawn`. Polls once per display frame until then,
   * whatever the pause reasons; it draws nothing while polling.
   */
  readonly drawWhenReady: (onDrawn: () => void) => void;
  readonly isRunning: () => boolean;
  readonly pauseReasons: () => ReadonlyArray<AmbientPauseReason>;
  readonly destroy: () => void;
}

export interface FrameLoopOptions {
  readonly clock: AmbientClock;
  /** Draws the light at `timeMs` of light time; returns false when nothing was drawn. */
  readonly draw: (timeMs: number) => boolean;
  /** Called when the running state or the pause reasons change. */
  readonly onChange: () => void;
}

export const createFrameLoop = ({ clock, draw, onChange }: FrameLoopOptions): FrameLoop => {
  const reasons = new Set<AmbientPauseReason>();
  let suspended = false;
  let destroyed = false;
  let handle: number | null = null;
  let retryHandle: number | null = null;
  let lightTime = 0;
  let lastFrameAt: number | null = null;
  let nextDrawAt: number | null = null;
  let lastInputAt = clock.now();

  const blocked = () => destroyed || suspended || reasons.size > 0;

  const tick = (time: number) => {
    handle = null;
    if (blocked()) return;
    if (time - lastInputAt >= AMBIENT_IDLE_MS) {
      reasons.add("idle");
      onChange();
      return;
    }
    if (nextDrawAt === null || time >= nextDrawAt - FRAME_SLACK_MS) {
      const step = lastFrameAt === null ? 0 : Math.min(time - lastFrameAt, MAX_STEP_MS);
      if (draw(lightTime + step)) lightTime += step;
      lastFrameAt = time;
      // Resync after a stall instead of drawing a burst of catch-up frames.
      nextDrawAt =
        nextDrawAt === null || time - nextDrawAt > AMBIENT_FRAME_MS
          ? time + AMBIENT_FRAME_MS
          : nextDrawAt + AMBIENT_FRAME_MS;
    }
    // A draw can end the light (shader failure), so check again before asking for more.
    if (!blocked()) handle = clock.requestFrame(tick);
  };

  const start = () => {
    if (handle !== null || blocked()) return;
    // The first frame after a pause draws at the frozen time: no jump on resume.
    lastFrameAt = null;
    nextDrawAt = null;
    handle = clock.requestFrame(tick);
  };

  const stop = () => {
    if (handle === null) return;
    clock.cancelFrame(handle);
    handle = null;
  };

  const update = () => {
    if (blocked()) stop();
    else start();
    onChange();
  };

  start();

  return {
    setPaused: (reason, paused) => {
      if (paused === reasons.has(reason)) return;
      if (paused) reasons.add(reason);
      else reasons.delete(reason);
      update();
    },
    input: () => {
      lastInputAt = clock.now();
      if (reasons.delete("idle")) update();
    },
    suspend: (next) => {
      if (next === suspended) return;
      suspended = next;
      update();
    },
    drawNow: () => {
      if (!destroyed) draw(lightTime);
    },
    drawWhenReady: (onDrawn) => {
      if (retryHandle !== null) clock.cancelFrame(retryHandle);
      retryHandle = null;
      const attempt = () => {
        retryHandle = null;
        if (destroyed) return;
        if (draw(lightTime)) onDrawn();
        else if (!destroyed) retryHandle = clock.requestFrame(attempt);
      };
      attempt();
    },
    isRunning: () => handle !== null,
    pauseReasons: () => [...reasons],
    destroy: () => {
      destroyed = true;
      stop();
      if (retryHandle !== null) clock.cancelFrame(retryHandle);
      retryHandle = null;
    },
  };
};
