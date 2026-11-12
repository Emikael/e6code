import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  applyInterfaceMotion,
  newlyCompletedSegments,
  nextMomentWatch,
  prefersReducedMotion,
  REDUCED_MOTION_ATTRIBUTE,
  resolveReducedMotion,
  subscribeReducedMotion,
} from "./motion";

function fakeRoot() {
  const attributes = new Set<string>();
  return {
    attributes,
    toggleAttribute(name: string, force: boolean) {
      if (force) attributes.add(name);
      else attributes.delete(name);
      return force;
    },
  } as unknown as HTMLElement & { attributes: Set<string> };
}

afterEach(() => {
  applyInterfaceMotion("system", fakeRoot());
  vi.unstubAllGlobals();
});

describe("resolveReducedMotion", () => {
  it("follows the system preference while the setting is System", () => {
    expect(resolveReducedMotion(false, "system")).toBe(false);
    expect(resolveReducedMotion(true, "system")).toBe(true);
  });

  it("is reduced whenever the setting is Reduced", () => {
    expect(resolveReducedMotion(false, "reduced")).toBe(true);
    expect(resolveReducedMotion(true, "reduced")).toBe(true);
  });
});

describe("applyInterfaceMotion", () => {
  it("forces reduced motion and marks the root, then hands back to the system", () => {
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    });
    const root = fakeRoot();
    const listener = vi.fn();
    const unsubscribe = subscribeReducedMotion(listener);

    applyInterfaceMotion("reduced", root);
    expect(prefersReducedMotion()).toBe(true);
    expect(root.attributes.has(REDUCED_MOTION_ATTRIBUTE)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    applyInterfaceMotion("system", root);
    expect(prefersReducedMotion()).toBe(false);
    expect(root.attributes.has(REDUCED_MOTION_ATTRIBUTE)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    applyInterfaceMotion("reduced", root);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps the system preference when the setting is System", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    applyInterfaceMotion("system", fakeRoot());
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe("nextMomentWatch", () => {
  const start = { key: "thread-a", value: false, count: 0 };

  it("counts a state turning on while the same thing stays in view", () => {
    const settled = nextMomentWatch(start, "thread-a", true);
    expect(settled.count).toBe(1);
    const unsettled = nextMomentWatch(settled, "thread-a", false);
    expect(nextMomentWatch(unsettled, "thread-a", true).count).toBe(2);
  });

  it("does not count opening something that is already on", () => {
    expect(nextMomentWatch(start, "thread-b", true).count).toBe(0);
  });

  it("does not count a value that arrives while the key is still loading", () => {
    const loading = nextMomentWatch(start, null, false);
    expect(nextMomentWatch(loading, null, true).count).toBe(0);
    const loaded = nextMomentWatch(nextMomentWatch(loading, null, true), "thread-a", true);
    expect(loaded.count).toBe(0);
  });
});

describe("newlyCompletedSegments", () => {
  const watch = (completedSteps: number, totalSteps = 5, key = "thread-a") => ({
    key,
    completedSteps,
    totalSteps,
  });

  it("fills the steps completed since the last render of the same plan", () => {
    expect(newlyCompletedSegments(watch(2), watch(3))).toEqual({ from: 2, to: 3 });
    expect(newlyCompletedSegments(watch(2), watch(4))).toEqual({ from: 2, to: 4 });
  });

  it("fills nothing on first sight, another thread, a replaced plan or no progress", () => {
    expect(newlyCompletedSegments(null, watch(3))).toBeNull();
    expect(newlyCompletedSegments(watch(2), watch(3, 5, "thread-b"))).toBeNull();
    expect(newlyCompletedSegments(watch(2), watch(3, 7))).toBeNull();
    expect(newlyCompletedSegments(watch(3), watch(3))).toBeNull();
    expect(newlyCompletedSegments(watch(3), watch(2))).toBeNull();
  });
});
