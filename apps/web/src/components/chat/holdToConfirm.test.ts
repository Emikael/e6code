import { HOLD_TO_CONFIRM_MS } from "@e6tools/client-runtime/destructive-commands";
import { describe, expect, it } from "vite-plus/test";

import {
  approvalShortcutAppliesTo,
  approvalShortcutClaimsKeyDown,
  approvalShortcutKeyUpReleases,
  createHoldToConfirm,
  destructiveApprovalPendingIn,
  SHORTCUT_FIRST_REPEAT_GRACE_MS,
  SHORTCUT_REPEAT_WATCHDOG_MS,
  type HoldSource,
} from "./holdToConfirm";

function harness() {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map<number, { callback: () => void; due: number }>();
  const events: string[] = [];
  const hold = createHoldToConfirm({
    onHoldingChange: (holding) => events.push(holding ? "holding" : "released"),
    setTimer: (callback, ms) => {
      nextTimer += 1;
      timers.set(nextTimer, { callback, due: now + ms });
      return nextTimer;
    },
    clearTimer: (timer) => timers.delete(timer as number),
  });
  /** Moves the clock forward, firing due timers in order. */
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const next = [...timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .toSorted((a, b) => a[1].due - b[1].due)[0];
      if (next === undefined) break;
      timers.delete(next[0]);
      now = next[1].due;
      next[1].callback();
    }
    now = target;
  };
  const confirm = () => events.push("confirmed");
  return {
    hold: {
      press: (source: HoldSource) => hold.press(source, confirm),
      repeat: hold.repeat,
      release: hold.release,
      cancel: hold.cancel,
    },
    timers,
    events,
    advance,
  };
}

describe("createHoldToConfirm", () => {
  it("confirms once the hold lasts the full duration", () => {
    const { hold, events, advance } = harness();
    hold.press("pointer");
    advance(HOLD_TO_CONFIRM_MS - 1);
    expect(events).toEqual(["holding"]);
    advance(1);
    expect(events).toEqual(["holding", "released", "confirmed"]);
  });

  it("does nothing when released early", () => {
    const { hold, timers, events } = harness();
    hold.press("key");
    hold.release("key");
    expect(timers.size).toBe(0);
    expect(events).toEqual(["holding", "released"]);
  });

  it("ignores a second press and releases from another source", () => {
    const { hold, events, advance } = harness();
    hold.press("key");
    hold.press("key");
    hold.press("pointer");
    hold.release("pointer");
    advance(HOLD_TO_CONFIRM_MS);
    expect(events).toEqual(["holding", "released", "confirmed"]);
  });

  it("confirms at most once per hold, even if the key stays down", () => {
    const { hold, events, advance } = harness();
    hold.press("key");
    advance(HOLD_TO_CONFIRM_MS);
    hold.press("key");
    advance(HOLD_TO_CONFIRM_MS);
    expect(events.filter((event) => event === "confirmed")).toHaveLength(1);
    hold.release("key");
    hold.press("key");
    advance(HOLD_TO_CONFIRM_MS);
    expect(events.filter((event) => event === "confirmed")).toHaveLength(2);
  });

  it("cancels a hold when focus leaves", () => {
    const { hold, timers, events } = harness();
    hold.press("pointer");
    hold.cancel();
    expect(timers.size).toBe(0);
    expect(events).toEqual(["holding", "released"]);
  });

  describe("shortcut holds", () => {
    const holdShortcutWithRepeats = (
      h: ReturnType<typeof harness>,
      firstRepeatMs: number,
      intervalMs: number,
    ) => {
      h.hold.press("shortcut");
      h.advance(firstRepeatMs);
      h.hold.repeat("shortcut");
      let elapsed = firstRepeatMs;
      while (elapsed + intervalMs <= HOLD_TO_CONFIRM_MS) {
        h.advance(intervalMs);
        h.hold.repeat("shortcut");
        elapsed += intervalMs;
      }
      h.advance(HOLD_TO_CONFIRM_MS - elapsed);
    };

    it("confirms while the key keeps auto-repeating", () => {
      const h = harness();
      holdShortcutWithRepeats(h, 400, 33);
      expect(h.events).toEqual(["holding", "released", "confirmed"]);
    });

    // macOS sends no keyup for Enter while ⌘ is down: tapping ⌘↵ and keeping
    // ⌘ held must not allow the command a second later.
    it("lapses when no repeat arrives after the tap", () => {
      const h = harness();
      h.hold.press("shortcut");
      h.advance(HOLD_TO_CONFIRM_MS);
      expect(h.events).toEqual(["holding", "released"]);
      expect(h.timers.size).toBe(0);
    });

    it("lapses when repeats stop partway through", () => {
      const h = harness();
      h.hold.press("shortcut");
      h.advance(SHORTCUT_FIRST_REPEAT_GRACE_MS - 100);
      h.hold.repeat("shortcut");
      h.advance(SHORTCUT_REPEAT_WATCHDOG_MS);
      expect(h.events).toEqual(["holding", "released"]);
      h.advance(HOLD_TO_CONFIRM_MS);
      expect(h.events).not.toContain("confirmed");
    });

    it("does not restart from repeats after it lapsed", () => {
      const h = harness();
      h.hold.press("shortcut");
      h.advance(SHORTCUT_FIRST_REPEAT_GRACE_MS);
      h.hold.repeat("shortcut");
      h.advance(HOLD_TO_CONFIRM_MS);
      expect(h.events).toEqual(["holding", "released"]);
    });

    it("leaves pointer and Enter/Space holds to their own release", () => {
      const h = harness();
      h.hold.press("pointer");
      h.hold.repeat("pointer");
      h.advance(HOLD_TO_CONFIRM_MS);
      expect(h.events).toEqual(["holding", "released", "confirmed"]);
    });
  });
});

describe("approvalShortcutKeyUpReleases", () => {
  const keyUp = (key: string, modifiers: { metaKey?: boolean; ctrlKey?: boolean } = {}) => ({
    key,
    metaKey: modifiers.metaKey ?? false,
    ctrlKey: modifiers.ctrlKey ?? false,
  });

  it("releases on Enter and on the modifier itself", () => {
    expect(approvalShortcutKeyUpReleases(keyUp("Enter"))).toBe(true);
    expect(approvalShortcutKeyUpReleases(keyUp("Meta"))).toBe(true);
    expect(approvalShortcutKeyUpReleases(keyUp("Control"))).toBe(true);
  });

  it("releases on any key let go while ⌘ or Ctrl is down", () => {
    expect(approvalShortcutKeyUpReleases(keyUp("k", { metaKey: true }))).toBe(true);
    expect(approvalShortcutKeyUpReleases(keyUp("Shift", { ctrlKey: true }))).toBe(true);
  });

  it("ignores unrelated keys without a modifier", () => {
    expect(approvalShortcutKeyUpReleases(keyUp("a"))).toBe(false);
  });
});

// Only `closest` and `querySelector` are consulted, so stand-ins keep these free of a DOM.
const element = (insideScope: boolean) =>
  ({
    closest: (selector: string) =>
      insideScope && selector === "[data-approval-shortcut-scope]" ? {} : null,
  }) as unknown as Element;

describe("approvalShortcutAppliesTo", () => {
  it("applies from the composer or an approval card", () => {
    expect(approvalShortcutAppliesTo(element(true))).toBe(true);
  });

  it("never applies with nothing focused", () => {
    expect(approvalShortcutAppliesTo(null)).toBe(false);
    // `document.body` is what is focused when nothing is; it is outside every scope.
    expect(approvalShortcutAppliesTo(element(false))).toBe(false);
  });
});

describe("approvalShortcutClaimsKeyDown", () => {
  const keyDown = (
    overrides: Partial<Parameters<typeof approvalShortcutClaimsKeyDown>[0]> = {},
  ) => ({
    key: "Enter",
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    defaultPrevented: false,
    ...overrides,
  });

  it("claims ⌘↵ and Ctrl+↵ inside an approval scope", () => {
    expect(approvalShortcutClaimsKeyDown(keyDown(), element(true))).toBe(true);
    expect(
      approvalShortcutClaimsKeyDown(keyDown({ metaKey: false, ctrlKey: true }), element(true)),
    ).toBe(true);
  });

  it("leaves ⌘↵ alone outside the scope", () => {
    expect(approvalShortcutClaimsKeyDown(keyDown(), element(false))).toBe(false);
    expect(approvalShortcutClaimsKeyDown(keyDown(), null)).toBe(false);
  });

  it("yields to a handler that already claimed the key", () => {
    expect(approvalShortcutClaimsKeyDown(keyDown({ defaultPrevented: true }), element(true))).toBe(
      false,
    );
  });

  it("ignores other chords and IME composition", () => {
    expect(approvalShortcutClaimsKeyDown(keyDown({ metaKey: false }), element(true))).toBe(false);
    expect(approvalShortcutClaimsKeyDown(keyDown({ shiftKey: true }), element(true))).toBe(false);
    expect(approvalShortcutClaimsKeyDown(keyDown({ altKey: true }), element(true))).toBe(false);
    expect(approvalShortcutClaimsKeyDown(keyDown({ isComposing: true }), element(true))).toBe(
      false,
    );
    expect(approvalShortcutClaimsKeyDown(keyDown({ key: "k" }), element(true))).toBe(false);
  });
});

describe("destructiveApprovalPendingIn", () => {
  const root = (marked: boolean) => ({
    querySelector: (selector: string) =>
      marked && selector === "[data-destructive-approval-hold]" ? ({} as Element) : null,
  });

  it("reports a hold-to-allow button on screen, so the merge shortcut stands down", () => {
    expect(destructiveApprovalPendingIn(root(true))).toBe(true);
    expect(destructiveApprovalPendingIn(root(false))).toBe(false);
  });
});
