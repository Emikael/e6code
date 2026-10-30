import { describe, expect, it } from "vite-plus/test";

import { shortcutKeyFromEvent } from "./keybindings.ts";

describe("shortcutKeyFromEvent", () => {
  it("maps every digit row code to its digit", () => {
    for (let digit = 0; digit <= 9; digit += 1) {
      expect(shortcutKeyFromEvent({ key: "?", code: `Digit${digit}` })).toBe(String(digit));
    }
  });

  it("reads the physical digit on layouts that shift the digit row", () => {
    // AZERTY types `"` on the Digit3 key without Shift.
    expect(shortcutKeyFromEvent({ key: '"', code: "Digit3" })).toBe("3");
  });

  it("keeps the layout letter", () => {
    expect(shortcutKeyFromEvent({ key: "z", code: "KeyW" })).toBe("z");
  });
});
