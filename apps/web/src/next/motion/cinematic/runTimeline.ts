import type { MotionLevel } from "@e6tools/client-runtime/motion-level";

import { type MotionPolicyStore, motionPolicy } from "../policy.ts";

/**
 * The cinematic seam (ENG-110): authored timelines run through this policy-aware runner and
 * never touch an engine directly. `gsap` and its adapter (`cinematic/gsapRunner.ts`, the only
 * file the lint rule lets import it) arrive with the first caller, the launch sequence
 * (E04-T16), loaded through `load` so the engine stays out of the entry and chat chunks.
 */
export interface CinematicTimeline {
  play(): void;
  /** Jumps to the end state. */
  progress(value: 1): void;
  kill(): void;
  onComplete(callback: () => void): void;
}

export interface CinematicEngine<Timeline extends CinematicTimeline> {
  createTimeline(): Timeline;
}

/**
 * Every sequence declares its Reduced form (opacity only, `DUR.reduced` or less). Off plays
 * neither: it builds the full sequence and jumps to its end.
 */
export interface CinematicSequence<Timeline extends CinematicTimeline> {
  readonly full: (timeline: Timeline) => void;
  readonly reduced: (timeline: Timeline) => void;
}

export type CinematicOutcome = "played" | "finished" | "cut" | "unavailable";

const RANK: Record<MotionLevel, number> = { off: 0, reduced: 1, full: 2 };

/**
 * Plays `sequence` at the policy's level. Data beats animation: an abort (unmount, or the
 * content the timeline decorates arriving) cuts to the end state, including when the engine
 * arrives after the abort. A level drop mid-flight does the same.
 */
export const runTimeline = async <Timeline extends CinematicTimeline>({
  load,
  sequence,
  policy = motionPolicy,
  signal,
}: {
  readonly load: () => Promise<CinematicEngine<Timeline>>;
  readonly sequence: CinematicSequence<Timeline>;
  readonly policy?: Pick<MotionPolicyStore, "getLevel" | "subscribe">;
  readonly signal?: AbortSignal;
}): Promise<CinematicOutcome> => {
  let engine: CinematicEngine<Timeline>;
  try {
    engine = await load();
  } catch {
    return "unavailable";
  }

  const timeline = engine.createTimeline();
  const finish = () => {
    timeline.progress(1);
    timeline.kill();
  };
  const startLevel = policy.getLevel();

  if (signal?.aborted) {
    sequence.full(timeline);
    finish();
    return "cut";
  }
  if (startLevel === "off") {
    sequence.full(timeline);
    finish();
    return "finished";
  }

  (startLevel === "full" ? sequence.full : sequence.reduced)(timeline);
  return new Promise<CinematicOutcome>((resolve) => {
    let settled = false;
    const settle = (outcome: CinematicOutcome) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      signal?.removeEventListener("abort", onAbort);
      if (outcome === "cut") finish();
      resolve(outcome);
    };
    const onAbort = () => settle("cut");
    const unsubscribe = policy.subscribe(() => {
      if (RANK[policy.getLevel()] < RANK[startLevel]) settle("cut");
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    timeline.onComplete(() => settle("played"));
    timeline.play();
  });
};
