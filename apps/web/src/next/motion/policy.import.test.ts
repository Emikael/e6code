import { afterEach, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// The page store reads the Motion setting, which has not hydrated in these tests, so it
// reads Off (E02-T06): a user who chose Off must never get Full frames before settings load.

it("imports and reads a level where window has no matchMedia", async () => {
  vi.stubGlobal("window", {});
  vi.resetModules();

  const { motionPolicy } = await import("./policy.ts");

  expect(motionPolicy.getLevel()).toBe("off");
});

it("imports and reads a level with no window at all", async () => {
  vi.resetModules();

  const { motionPolicy } = await import("./policy.ts");

  expect(motionPolicy.getLevel()).toBe("off");
});
