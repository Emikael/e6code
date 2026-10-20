import { describe, expect, it } from "vite-plus/test";

import { resolveSwitchboardColumnWidth } from "./threadSidebarWidth";

describe("resolveSwitchboardColumnWidth", () => {
  it("defaults by viewport and clamps persisted widths to 256–420", () => {
    expect(resolveSwitchboardColumnWidth(null, 1440)).toBe(324);
    expect(resolveSwitchboardColumnWidth(null, 1366)).toBe(300);
    expect(resolveSwitchboardColumnWidth(null, 1100)).toBe(272);
    expect(resolveSwitchboardColumnWidth(180, 1440)).toBe(256);
    expect(resolveSwitchboardColumnWidth(512, 1600)).toBe(420);
    expect(resolveSwitchboardColumnWidth(360, 1440)).toBe(360);
  });
});
