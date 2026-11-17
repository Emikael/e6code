import { describe, expect, it } from "vite-plus/test";

import {
  parseStartupMark,
  resolveStartupShellSyncStatus,
  startupLandingMark,
  startupShellInteractiveMark,
} from "./startupMarks.ts";

describe("startup marks", () => {
  it("reads back every mark the builders produce", () => {
    for (const landing of ["app", "welcome", "pair", "requires-auth"] as const) {
      expect(parseStartupMark(startupLandingMark(landing))).toEqual({ kind: "landing", landing });
    }
    for (const syncStatus of ["cached", "synchronizing", "live"] as const) {
      expect(parseStartupMark(startupShellInteractiveMark(syncStatus))).toEqual({
        kind: "shell-interactive",
        syncStatus,
      });
    }
  });

  it("ignores marks it does not define", () => {
    expect(parseStartupMark("first-paint")).toBeNull();
    expect(parseStartupMark("e6:startup:landing")).toBeNull();
    expect(parseStartupMark("e6:startup:landing:settings")).toBeNull();
    expect(parseStartupMark("e6:startup:shell-interactive:none")).toBeNull();
    expect(parseStartupMark("e6:startup:unknown:app")).toBeNull();
  });

  it("reports the least-synced snapshot on screen, once there is one", () => {
    expect(resolveStartupShellSyncStatus([])).toBeNull();
    expect(resolveStartupShellSyncStatus([{ hasSnapshot: false, status: "empty" }])).toBeNull();
    expect(
      resolveStartupShellSyncStatus([
        { hasSnapshot: true, status: "live" },
        { hasSnapshot: false, status: "synchronizing" },
      ]),
    ).toBe("live");
    expect(
      resolveStartupShellSyncStatus([
        { hasSnapshot: true, status: "live" },
        { hasSnapshot: true, status: "synchronizing" },
      ]),
    ).toBe("synchronizing");
    expect(
      resolveStartupShellSyncStatus([
        { hasSnapshot: true, status: "synchronizing" },
        { hasSnapshot: true, status: "cached" },
      ]),
    ).toBe("cached");
  });
});
