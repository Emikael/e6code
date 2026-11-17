import { EnvironmentId, type DesktopLocalEnvironmentStatus } from "@e6tools/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  localEnvironmentDetailLines,
  localEnvironmentNoticeCopy,
  localEnvironmentPanelCopy,
  localEnvironmentSendToastCopy,
  localEnvironmentWord,
  localEnvironmentWordAtom,
  showsLocalEnvironmentStage,
  STILL_STARTING_AFTER_MS,
  type LocalEnvironmentWord,
} from "./localEnvironmentWord";

const SINCE = 1_800_000_000_000;

const status = (
  patch: Partial<DesktopLocalEnvironmentStatus> & Pick<DesktopLocalEnvironmentStatus, "state">,
): DesktopLocalEnvironmentStatus => ({
  environmentId: EnvironmentId.make("env-local"),
  label: "Local environment",
  sinceEpochMs: SINCE,
  restartAttempt: 0,
  reason: null,
  ...patch,
});

const wordFor = (patch: Parameters<typeof status>[0], nowMs = SINCE): LocalEnvironmentWord => {
  const word = localEnvironmentWord(status(patch), nowMs);
  if (word === null) throw new Error("expected a starting word");
  return word;
};

describe("localEnvironmentWord", () => {
  it("has no starting word once ready, after a deliberate stop, or without a status", () => {
    expect(localEnvironmentWord(status({ state: "ready" }), SINCE)).toBeNull();
    expect(localEnvironmentWord(status({ state: "stopped", reason: "quit" }), SINCE)).toBeNull();
    expect(localEnvironmentWord(null, SINCE)).toBeNull();
    expect(localEnvironmentWord(undefined, SINCE)).toBeNull();
  });

  it("escalates a start once, 15 s after it began, and says when", () => {
    const starting = wordFor({ state: "starting" }, SINCE + STILL_STARTING_AFTER_MS - 1);
    expect(starting).toMatchObject({
      kind: "starting",
      word: "Starting…",
      dotPhase: "connecting",
      escalatesAtEpochMs: SINCE + STILL_STARTING_AFTER_MS,
    });

    // A reload long after the start reads the escalated words at once.
    const still = wordFor({ state: "starting" }, SINCE + STILL_STARTING_AFTER_MS);
    expect(still).toMatchObject({
      kind: "still-starting",
      word: "Still starting…",
      dotPhase: "connecting",
      escalatesAtEpochMs: null,
    });
    expect(localEnvironmentDetailLines(still)).toEqual([
      { text: "Taking longer than usual.", mono: false },
    ]);
  });

  it("puts a failure before a restart, and a restart before the start wording", () => {
    // Failure and restart never escalate by time, however long they last.
    const late = SINCE + 10 * STILL_STARTING_AFTER_MS;
    expect(wordFor({ state: "failed", reason: "code=1" }, late)).toMatchObject({
      kind: "failed",
      word: "Couldn't start",
      dotPhase: "error",
      reason: "code=1",
    });
    expect(wordFor({ state: "restarting", restartAttempt: 2 }, late)).toMatchObject({
      kind: "restarting",
      word: "Restarting…",
      dotPhase: "reconnecting",
      escalatesAtEpochMs: null,
    });
  });

  it("explains an unplanned restart, and nothing about a planned one", () => {
    const unplanned = wordFor({ state: "restarting", restartAttempt: 3, reason: "code=1" });
    expect(localEnvironmentDetailLines(unplanned)).toEqual([
      { text: "Stopped unexpectedly. Trying again, attempt 3.", mono: false },
      { text: "code=1", mono: true },
    ]);

    const planned = wordFor({ state: "restarting", restartAttempt: 0, reason: "stale" });
    expect(planned).toMatchObject({ attempt: null, reason: null });
    expect(localEnvironmentDetailLines(planned)).toEqual([]);
    expect(localEnvironmentNoticeCopy(planned)).toEqual({
      variant: "default",
      icon: "dot",
      title: "Restarting the local environment",
      description: null,
      reason: null,
    });
  });

  it("says when a failure gave no reason", () => {
    const failed = wordFor({ state: "failed", reason: null });
    expect(localEnvironmentDetailLines(failed)).toEqual([
      { text: "No reason was reported.", mono: false },
    ]);
    expect(localEnvironmentNoticeCopy(failed)).toMatchObject({
      variant: "error",
      icon: "alert",
      title: "The local environment couldn't start",
      reason: { text: "No reason was reported.", mono: false },
    });
  });
});

describe("local environment notices", () => {
  it("keeps a normal start calm and turns only real trouble into a warning or error", () => {
    expect(localEnvironmentNoticeCopy(wordFor({ state: "starting" }))).toEqual({
      variant: "default",
      icon: "dot",
      title: "Starting the local environment",
      description: "You can send once it's ready.",
      reason: null,
    });
    expect(
      localEnvironmentNoticeCopy(wordFor({ state: "starting" }, SINCE + STILL_STARTING_AFTER_MS)),
    ).toMatchObject({
      variant: "default",
      title: "Still starting the local environment",
      description: "This is taking longer than usual.",
    });
    expect(
      localEnvironmentNoticeCopy(
        wordFor({ state: "restarting", restartAttempt: 2, reason: "code=1" }),
      ),
    ).toEqual({
      variant: "warning",
      icon: "restart",
      title: "Restarting the local environment",
      description: "It stopped unexpectedly (attempt 2).",
      reason: { text: "code=1", mono: true },
    });
  });

  it("tells a refused send what the local environment is doing", () => {
    expect(localEnvironmentSendToastCopy(wordFor({ state: "starting" }))).toEqual({
      title: "Message not sent",
      description: "The local environment is still starting. Try again once it's ready.",
    });
    expect(
      localEnvironmentSendToastCopy(wordFor({ state: "restarting", restartAttempt: 1 })),
    ).toEqual({
      title: "Message not sent",
      description: "The local environment is restarting. Try again once it's ready.",
    });
    expect(localEnvironmentSendToastCopy(wordFor({ state: "failed" }))).toEqual({
      title: "Message not sent",
      description: "The local environment couldn't start.",
    });
  });
});

describe("localEnvironmentPanelCopy", () => {
  it("continues the boot shell on first run, naming WSL when that is the local environment", () => {
    expect(
      localEnvironmentPanelCopy(wordFor({ state: "starting" }), {
        placement: "window",
        label: "Local environment",
      }),
    ).toEqual({
      title: "Starting E6 Code",
      lines: ["Getting the local environment ready."],
      attempt: null,
      reason: null,
    });
    expect(
      localEnvironmentPanelCopy(wordFor({ state: "starting" }, SINCE + STILL_STARTING_AFTER_MS), {
        placement: "window",
        label: "WSL (Ubuntu)",
      }).lines,
    ).toEqual(["Connecting to WSL…", "This is taking longer than usual."]);
  });

  it("keeps the attempt and the reason out of the announced lines", () => {
    const copy = localEnvironmentPanelCopy(
      wordFor({ state: "restarting", restartAttempt: 3, reason: "code=1" }),
      { placement: "window", label: "Local environment" },
    );
    expect(copy).toEqual({
      title: "E6 Code couldn't start its local environment",
      lines: [],
      attempt: "Trying again (attempt 3).",
      reason: { text: "code=1", mono: true },
    });
  });

  it("reads a planned restart, a stop or no status as a start", () => {
    for (const word of [wordFor({ state: "restarting", restartAttempt: 0 }), null]) {
      expect(localEnvironmentPanelCopy(word, { placement: "stage", label: null })).toEqual({
        title: "Starting the local environment",
        lines: ["Your projects and threads appear here once it's ready."],
        attempt: null,
        reason: null,
      });
    }
  });

  it("names a failure in the stage without retry wording", () => {
    expect(
      localEnvironmentPanelCopy(wordFor({ state: "failed" }), {
        placement: "stage",
        label: "Local environment",
      }),
    ).toEqual({
      title: "The local environment couldn't start",
      lines: [],
      attempt: null,
      reason: { text: "No reason was reported.", mono: false },
    });
  });
});

describe("showsLocalEnvironmentStage", () => {
  const base = {
    localStarting: true,
    bootstrapped: true,
    landingProjectEnvironmentId: "env-local",
    primaryEnvironmentId: "env-local",
    draftStartFailed: false,
  };

  it("never leaves the stage blank while a local draft waits for the backend", () => {
    expect(showsLocalEnvironmentStage(base)).toBe(true);
    expect(showsLocalEnvironmentStage({ ...base, bootstrapped: false })).toBe(true);
    // No project anywhere: "Add a project" would be untrue while the local list is unknown.
    expect(showsLocalEnvironmentStage({ ...base, landingProjectEnvironmentId: null })).toBe(true);
  });

  it("keeps a remote draft, a failed draft and a ready environment as today", () => {
    expect(showsLocalEnvironmentStage({ ...base, landingProjectEnvironmentId: "env-remote" })).toBe(
      false,
    );
    expect(showsLocalEnvironmentStage({ ...base, draftStartFailed: true })).toBe(false);
    expect(showsLocalEnvironmentStage({ ...base, localStarting: false })).toBe(false);
  });
});

describe("localEnvironmentWordAtom", { concurrent: false }, () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("escalates from one timer and follows status pushes, with nothing ticking at idle", () => {
    vi.useFakeTimers({ now: SINCE + 2_000 });
    let push: ((next: DesktopLocalEnvironmentStatus) => void) | undefined;
    vi.stubGlobal("window", {
      desktopBridge: {
        getLocalEnvironmentStatus: () => status({ state: "starting" }),
        onLocalEnvironmentStatus: (listener: (next: DesktopLocalEnvironmentStatus) => void) => {
          push = listener;
          return () => {
            push = undefined;
          };
        },
      },
    });
    const registry = AtomRegistry.make();
    const unmount = registry.mount(localEnvironmentWordAtom);

    expect(registry.get(localEnvironmentWordAtom)?.word).toBe("Starting…");
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(STILL_STARTING_AFTER_MS - 2_001);
    expect(registry.get(localEnvironmentWordAtom)?.word).toBe("Starting…");
    vi.advanceTimersByTime(1);
    expect(registry.get(localEnvironmentWordAtom)?.word).toBe("Still starting…");
    expect(vi.getTimerCount()).toBe(0);

    push?.(status({ state: "restarting", restartAttempt: 1, reason: "code=1" }));
    expect(registry.get(localEnvironmentWordAtom)?.word).toBe("Restarting…");
    push?.(status({ state: "ready" }));
    expect(registry.get(localEnvironmentWordAtom)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });
});
