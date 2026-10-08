import { describe, expect, it } from "vite-plus/test";

import { highlightGhostFrame } from "./commandListMotion";

describe("highlightGhostFrame", () => {
  it("places the ghost in the overlay's box, not the list's scroll content", () => {
    expect(
      highlightGhostFrame({ top: 100, left: 40 }, { top: 180, left: 48, width: 220, height: 32 }),
    ).toEqual({ top: 80, left: 8, width: 220, height: 32 });
  });
});
