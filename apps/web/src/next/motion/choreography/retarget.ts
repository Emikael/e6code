/** A running animation, as the engine reports it. */
export interface RunningAnimation {
  /** Stops where it is and commits the current value. */
  stop(): void;
  /** Jumps to the end state. */
  complete(): void;
  readonly finished: Promise<unknown>;
}

export type Keyframes = Record<string, ReadonlyArray<string | number>>;

export interface OneShotTiming {
  /** Seconds. */
  readonly duration: number;
  readonly ease: "linear" | readonly [number, number, number, number];
}

/**
 * The engine call: `motion/mini`'s `animate` in the app, a fake in tests. A first keyframe
 * of `null` means "start from the computed value".
 */
export type AnimateDriver<Target> = (
  target: Target,
  keyframes: Record<string, Array<string | number | null>>,
  timing: OneShotTiming,
) => RunningAnimation;

/**
 * Interruption for imperative one-shots: a new run on a target stops the running one, which
 * commits its current value, and starts from that value. Nothing queues; the newest request
 * wins, and at most one run per target is live.
 */
export const createRetargeter = <Target extends object>(driver: AnimateDriver<Target>) => {
  const running = new WeakMap<Target, RunningAnimation>();

  const stop = (target: Target) => {
    running.get(target)?.stop();
    running.delete(target);
  };

  return {
    run(target: Target, keyframes: Keyframes, timing: OneShotTiming) {
      stop(target);
      const fromCurrent = Object.fromEntries(
        Object.entries(keyframes).map(([name, frames]) => [name, [null, ...frames]]),
      );
      const animation = driver(target, fromCurrent, timing);
      running.set(target, animation);
      void animation.finished
        .catch(() => undefined)
        .finally(() => {
          if (running.get(target) === animation) running.delete(target);
        });
      return animation;
    },
    /** Data beats animation: jump the target's run to its end state. */
    finish(target: Target) {
      running.get(target)?.complete();
      running.delete(target);
    },
    isRunning: (target: Target) => running.has(target),
  };
};
