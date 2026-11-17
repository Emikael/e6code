import { describe, expect, it } from "vite-plus/test";

import {
  initialPresenceSlots,
  type PresenceSlot,
  presenceSlots,
  presentSlot,
} from "./presenceSlots.ts";

const show = (slots: ReadonlyArray<PresenceSlot<string>>, key: string) =>
  presenceSlots(slots, { type: "show", key, content: key });

describe("presence slots", () => {
  it("does not animate what was there on mount", () => {
    expect(initialPresenceSlots("Running", "Running")).toEqual([
      { key: "Running", content: "Running", leaving: false, enters: false },
    ]);
  });

  it("swaps in the new value while the old one leaves", () => {
    const slots = show(initialPresenceSlots("Running", "Running"), "Done");
    expect(slots).toEqual([
      { key: "Running", content: "Running", leaving: true, enters: false },
      { key: "Done", content: "Done", leaving: false, enters: true },
    ]);
  });

  it("keeps at most two slots under rapid changes, the newest present", () => {
    let slots = initialPresenceSlots("0", "0");
    for (let value = 1; value <= 20; value++) {
      slots = show(slots, String(value));
      expect(slots.length).toBeLessThanOrEqual(2);
      expect(slots.filter((slot) => !slot.leaving)).toHaveLength(1);
    }
    expect(presentSlot(slots)?.key).toBe("20");
    expect(slots.find((slot) => slot.leaving)?.key).toBe("19");
  });

  it("retargets a value that comes back while it is leaving", () => {
    let slots = show(initialPresenceSlots("Copy", "Copy"), "Copied");
    slots = show(slots, "Copy");
    // The returning value takes its old key back, so its element reverses from where it is.
    expect(slots.map(({ key, leaving }) => [key, leaving])).toEqual([
      ["Copied", true],
      ["Copy", false],
    ]);
  });

  it("ignores the present value shown again", () => {
    const slots = show(initialPresenceSlots("Done", "Done"), "Done");
    expect(slots).toEqual(initialPresenceSlots("Done", "Done"));
  });

  it("drops a slot once its exit ends, and only a leaving one", () => {
    let slots = show(initialPresenceSlots("Running", "Running"), "Done");
    slots = presenceSlots(slots, { type: "left", key: "Done" });
    expect(slots).toHaveLength(2);
    slots = presenceSlots(slots, { type: "left", key: "Running" });
    expect(slots).toEqual([{ key: "Done", content: "Done", leaving: false, enters: true }]);
  });
});
