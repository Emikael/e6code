import type { MotionLevel } from "@e6tools/client-runtime/motion-level";
import { describe, expect, it } from "vite-plus/test";

import { syncMotionAttribute } from "./motionAttribute.ts";

describe("syncMotionAttribute", () => {
  it("mirrors the level, follows changes and removes itself", () => {
    const attributes = new Map<string, string>();
    const root = {
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
      removeAttribute: (name: string) => void attributes.delete(name),
    };
    let level: MotionLevel = "full";
    const listeners = new Set<() => void>();
    const policy = {
      getLevel: () => level,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    };

    const stop = syncMotionAttribute(root, policy);
    expect(attributes.get("data-motion")).toBe("full");

    level = "off";
    for (const listener of listeners) listener();
    expect(attributes.get("data-motion")).toBe("off");

    stop();
    expect(attributes.has("data-motion")).toBe(false);
    expect(listeners.size).toBe(0);
  });
});
