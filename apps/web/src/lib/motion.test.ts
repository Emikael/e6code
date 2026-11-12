import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  applyInterfaceMotion,
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
