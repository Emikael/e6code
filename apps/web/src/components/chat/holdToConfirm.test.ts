import { describe, expect, it } from "vite-plus/test";

import {
  approvalShortcutAppliesTo,
  createHoldToConfirm,
  HOLD_TO_CONFIRM_MS,
  type HoldSource,
} from "./holdToConfirm";

function harness() {
  const timers = new Map<number, { callback: () => void; ms: number }>();
  let nextTimer = 0;
  const events: string[] = [];
  const hold = createHoldToConfirm({
    onHoldingChange: (holding) => events.push(holding ? "holding" : "released"),
    setTimer: (callback, ms) => {
      nextTimer += 1;
      timers.set(nextTimer, { callback, ms });
      return nextTimer;
    },
    clearTimer: (timer) => timers.delete(timer as number),
  });
  const elapse = () => {
    const pending = [...timers.values()];
    timers.clear();
    for (const timer of pending) timer.callback();
  };
  const confirm = () => events.push("confirmed");
  return {
    hold: {
      press: (source: HoldSource) => hold.press(source, confirm),
      release: hold.release,
      cancel: hold.cancel,
    },
    timers,
    events,
    elapse,
  };
}

describe("createHoldToConfirm", () => {
  it("confirms once the hold lasts the full duration", () => {
    const { hold, timers, events, elapse } = harness();
    hold.press("pointer");
    expect([...timers.values()].map((timer) => timer.ms)).toEqual([HOLD_TO_CONFIRM_MS]);
    elapse();
    expect(events).toEqual(["holding", "released", "confirmed"]);
  });

  it("does nothing when released early", () => {
    const { hold, timers, events } = harness();
    hold.press("key");
    hold.release("key");
    expect(timers.size).toBe(0);
    expect(events).toEqual(["holding", "released"]);
  });

  it("ignores key repeat and releases from another source", () => {
    const { hold, timers, events, elapse } = harness();
    hold.press("shortcut");
    hold.press("shortcut");
    hold.press("pointer");
    hold.release("pointer");
    expect(timers.size).toBe(1);
    elapse();
    expect(events).toEqual(["holding", "released", "confirmed"]);
  });

  it("confirms at most once per hold, even if the key stays down", () => {
    const { hold, events, elapse } = harness();
    hold.press("key");
    elapse();
    hold.press("key");
    elapse();
    expect(events.filter((event) => event === "confirmed")).toHaveLength(1);
    hold.release("key");
    hold.press("key");
    elapse();
    expect(events.filter((event) => event === "confirmed")).toHaveLength(2);
  });

  it("cancels a hold when focus leaves", () => {
    const { hold, timers, events } = harness();
    hold.press("pointer");
    hold.cancel();
    expect(timers.size).toBe(0);
    expect(events).toEqual(["holding", "released"]);
  });
});

describe("approvalShortcutAppliesTo", () => {
  // Only `closest` is consulted, so a stand-in keeps this test free of a DOM.
  const element = (insideScope: boolean) =>
    ({
      closest: (selector: string) =>
        insideScope && selector === "[data-approval-shortcut-scope]" ? {} : null,
    }) as unknown as Element;
  const body = element(false);

  it("applies with nothing focused", () => {
    expect(approvalShortcutAppliesTo(null, body)).toBe(true);
    expect(approvalShortcutAppliesTo(body, body)).toBe(true);
  });

  it("applies from the composer or an approval card", () => {
    expect(approvalShortcutAppliesTo(element(true), body)).toBe(true);
  });

  it("leaves ⌘↵ alone everywhere else", () => {
    expect(approvalShortcutAppliesTo(element(false), body)).toBe(false);
  });
});
