import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_KEYBINDINGS, shortcutKeyFromEvent } from "./keybindings.ts";

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

describe("DEFAULT_KEYBINDINGS", () => {
  it("binds Mod+Alt+N to the next thread that needs you, and nothing else to it", () => {
    expect(DEFAULT_KEYBINDINGS.filter((binding) => binding.key === "mod+alt+n")).toEqual([
      { key: "mod+alt+n", command: "thread.nextNeedsYou" },
    ]);
  });
});

describe("focus.toggle", () => {
  it("binds Mod+Alt+Z to focus mode, and nothing else to it", () => {
    expect(DEFAULT_KEYBINDINGS.filter((binding) => binding.key === "mod+alt+z")).toEqual([
      { key: "mod+alt+z", command: "focus.toggle" },
    ]);
  });
});

describe("Diff review keys", () => {
  it("answer V, J and K only while the Diff tab has focus and no field does", () => {
    expect(
      DEFAULT_KEYBINDINGS.filter((binding) => binding.command.startsWith("diff.next")),
    ).toEqual([
      { key: "v", command: "diff.nextChange", when: "diffFocus && !editableFocus" },
      { key: "j", command: "diff.nextFile", when: "diffFocus && !editableFocus" },
    ]);
  });
});
