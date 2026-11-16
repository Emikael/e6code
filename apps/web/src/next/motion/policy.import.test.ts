import { afterEach, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("imports and reads a level where window has no matchMedia", async () => {
  vi.stubGlobal("window", {});
  vi.resetModules();

  const { motionPolicy } = await import("./policy.ts");

  expect(motionPolicy.getLevel()).toBe("full");
});

it("imports and reads a level with no window at all", async () => {
  vi.resetModules();

  const { motionPolicy } = await import("./policy.ts");

  expect(motionPolicy.getLevel()).toBe("full");
});
