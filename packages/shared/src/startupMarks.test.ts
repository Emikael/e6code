import { describe, expect, it } from "vite-plus/test";

import {
  parseStartupMark,
  resolveStartupShellSource,
  startupLandingMark,
  startupShellInteractiveMark,
} from "./startupMarks.ts";

describe("startup marks", () => {
  it("reads back every mark the builders produce", () => {
    for (const landing of ["app", "welcome", "pair", "requires-auth"] as const) {
      expect(parseStartupMark(startupLandingMark(landing))).toEqual({ kind: "landing", landing });
    }
    for (const source of ["cache", "live", "none"] as const) {
      expect(parseStartupMark(startupShellInteractiveMark(source))).toEqual({
        kind: "shell-interactive",
        source,
      });
    }
  });

  it("ignores marks it does not define", () => {
    expect(parseStartupMark("first-paint")).toBeNull();
    expect(parseStartupMark("e6:startup:landing")).toBeNull();
    expect(parseStartupMark("e6:startup:landing:settings")).toBeNull();
    expect(parseStartupMark("e6:startup:shell-interactive:stale")).toBeNull();
    expect(parseStartupMark("e6:startup:unknown:app")).toBeNull();
  });

  it("classifies the shell's data by what each environment was showing", () => {
    expect(resolveStartupShellSource([])).toBe("none");
    expect(resolveStartupShellSource([{ hasSnapshot: false, live: false }])).toBe("none");
    expect(
      resolveStartupShellSource([
        { hasSnapshot: true, live: true },
        { hasSnapshot: false, live: false },
      ]),
    ).toBe("live");
    expect(
      resolveStartupShellSource([
        { hasSnapshot: true, live: true },
        { hasSnapshot: true, live: false },
      ]),
    ).toBe("cache");
  });
});
