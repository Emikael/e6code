import { describe, expect, it } from "vite-plus/test";

import { soakCycleIntervalMs, SoakTurnScheduler, type ShellThreadView } from "./soakScheduler.ts";

const view = (
  id: string,
  turn: { readonly turnId: string; readonly state: string } | null,
  session: { readonly status: string; readonly activeTurnId: string | null } | null = null,
): ShellThreadView => ({ id, latestTurn: turn, session });

const THREADS = [
  { threadId: "t-cursor", kind: "cursor" },
  { threadId: "t-codex", kind: "codex" },
];

function started() {
  const scheduler = new SoakTurnScheduler(THREADS);
  // The shell snapshot: both threads end on a seeded, completed turn.
  scheduler.observe(view("t-cursor", { turnId: "seed-c", state: "completed" }), 0);
  scheduler.observe(view("t-codex", { turnId: "seed-x", state: "completed" }), 0);
  expect(scheduler.start(0)).toEqual(["t-cursor", "t-codex"]);
  return scheduler;
}

describe("SoakTurnScheduler", () => {
  it("dispatches the next turn once per finished turn, however often the shell repeats it", () => {
    const scheduler = started();
    expect(
      scheduler.observe(view("t-cursor", { turnId: "seed-c", state: "completed" }), 5),
    ).toBeNull();
    expect(
      scheduler.observe(view("t-cursor", { turnId: "turn-1", state: "running" }), 10),
    ).toBeNull();
    expect(scheduler.observe(view("t-cursor", { turnId: "turn-1", state: "completed" }), 20)).toBe(
      "t-cursor",
    );
    expect(
      scheduler.observe(view("t-cursor", { turnId: "turn-1", state: "completed" }), 21),
    ).toBeNull();
    expect(scheduler.observe(view("t-cursor", { turnId: "turn-2", state: "completed" }), 40)).toBe(
      "t-cursor",
    );
    expect(scheduler.summary()["t-cursor"]).toMatchObject({
      kind: "cursor",
      dispatched: 3,
      completed: 2,
    });
  });

  it("counts a turn whose running state the shell coalesced away", () => {
    const scheduler = started();
    expect(scheduler.observe(view("t-codex", { turnId: "turn-9", state: "interrupted" }), 30)).toBe(
      "t-codex",
    );
    expect(scheduler.summary()["t-codex"]).toMatchObject({ interrupted: 1, completed: 0 });
  });

  it("waits while the session still runs the turn the shell already shows as finished", () => {
    const scheduler = started();
    const done = { turnId: "turn-1", state: "completed" };
    expect(
      scheduler.observe(view("t-cursor", done, { status: "running", activeTurnId: "turn-1" }), 10),
    ).toBeNull();
    expect(
      scheduler.observe(view("t-cursor", done, { status: "ready", activeTurnId: null }), 12),
    ).toBe("t-cursor");
  });

  it("stops dispatching after stop but keeps counting", () => {
    const scheduler = started();
    scheduler.stop();
    expect(
      scheduler.observe(view("t-cursor", { turnId: "turn-1", state: "completed" }), 10),
    ).toBeNull();
    expect(scheduler.summary()["t-cursor"]).toMatchObject({ completed: 1, dispatched: 1 });
  });

  it("gives up on a thread after three failed turns in a row", () => {
    const scheduler = started();
    expect(scheduler.observe(view("t-codex", { turnId: "e1", state: "error" }), 1)).toBe("t-codex");
    expect(scheduler.observe(view("t-codex", { turnId: "e2", state: "error" }), 2)).toBe("t-codex");
    expect(scheduler.observe(view("t-codex", { turnId: "e3", state: "error" }), 3)).toBeNull();
    expect(scheduler.summary()["t-codex"]).toMatchObject({ errors: 3, gaveUp: true });
  });

  it("re-arms a thread whose dispatch was rejected only when asked to retry", () => {
    const scheduler = started();
    expect(scheduler.observe(view("t-cursor", { turnId: "turn-1", state: "completed" }), 10)).toBe(
      "t-cursor",
    );
    scheduler.dispatchFailed("t-cursor", "busy");
    expect(
      scheduler.observe(view("t-cursor", { turnId: "turn-1", state: "completed" }), 11),
    ).toBeNull();
    expect(scheduler.retry("t-cursor", 12)).toBe(true);
    expect(scheduler.observe(view("t-cursor", { turnId: "turn-2", state: "completed" }), 30)).toBe(
      "t-cursor",
    );
    expect(scheduler.summary()["t-cursor"]).toMatchObject({
      dispatchFailures: 1,
      lastDispatchError: "busy",
      completed: 2,
    });
  });

  it("names threads that have waited longer than a limit for their turn to end", () => {
    const scheduler = started();
    scheduler.observe(view("t-cursor", { turnId: "turn-1", state: "completed" }), 10_000);
    expect(scheduler.stalled(70_000, 60_000)).toEqual(["t-codex"]);
  });

  it("ignores threads it does not drive", () => {
    const scheduler = started();
    expect(scheduler.observe(view("other", { turnId: "x", state: "completed" }), 1)).toBeNull();
  });
});

describe("soakCycleIntervalMs", () => {
  it("clicks often enough that the page visits every thread once inside the soak", () => {
    for (const [minutes, threads] of [
      [6, 50],
      [1, 50],
      [1, 12],
      [0.5, 7],
    ] as const) {
      const durationMs = minutes * 60_000;
      const interval = soakCycleIntervalMs(durationMs, threads);
      // The first click is at the start, so click n lands at (n - 1) * interval.
      expect((threads - 1) * interval, `${minutes} min, ${threads} threads`).toBeLessThan(
        durationMs,
      );
    }
    expect(soakCycleIntervalMs(360_000, 50)).toBe(7_200);
  });

  it("never waits more than 10 s between clicks", () => {
    expect(soakCycleIntervalMs(60 * 60_000, 50)).toBe(10_000);
    expect(soakCycleIntervalMs(360_000, 0)).toBe(10_000);
  });
});
