import { describe, expect, it } from "vite-plus/test";

import {
  parseStartupMark,
  resolveStartupShellSnapshotSource,
  resolveStartupShellSyncStatus,
  startupLandingMark,
  startupShellInteractiveMark,
  startupShellLiveMark,
} from "./startupMarks.ts";

describe("startup marks", () => {
  it("reads back every mark the builders produce", () => {
    for (const landing of ["app", "welcome", "pair", "requires-auth", "starting"] as const) {
      expect(parseStartupMark(startupLandingMark(landing))).toEqual({ kind: "landing", landing });
    }
    for (const syncStatus of ["cached", "synchronizing", "live"] as const) {
      expect(parseStartupMark(startupShellInteractiveMark(syncStatus))).toEqual({
        kind: "shell-interactive",
        syncStatus,
      });
      for (const source of ["cache", "server"] as const) {
        expect(parseStartupMark(startupShellInteractiveMark(syncStatus, source))).toEqual({
          kind: "shell-interactive",
          syncStatus,
          source,
        });
      }
    }
    expect(parseStartupMark(startupShellLiveMark())).toEqual({ kind: "shell-live" });
  });

  it("still reads the shell-interactive mark of builds that predate its source", () => {
    expect(parseStartupMark("e6:startup:shell-interactive:cached")).toEqual({
      kind: "shell-interactive",
      syncStatus: "cached",
    });
  });

  it("ignores marks it does not define", () => {
    expect(parseStartupMark("first-paint")).toBeNull();
    expect(parseStartupMark("e6:startup:landing")).toBeNull();
    expect(parseStartupMark("e6:startup:landing:settings")).toBeNull();
    expect(parseStartupMark("e6:startup:shell-interactive:none")).toBeNull();
    expect(parseStartupMark("e6:startup:unknown:app")).toBeNull();
    expect(parseStartupMark("e6:startup:shell-interactive:live:disk")).toBeNull();
    expect(parseStartupMark("e6:startup:shell-interactive:live:cache:extra")).toBeNull();
    expect(parseStartupMark("e6:startup:shell-live:now")).toBeNull();
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

  it("reads the shell as cached while any snapshot on screen came from the cache", () => {
    expect(resolveStartupShellSnapshotSource([])).toBeNull();
    expect(
      resolveStartupShellSnapshotSource([{ hasSnapshot: false, snapshotSource: undefined }]),
    ).toBeNull();
    expect(
      resolveStartupShellSnapshotSource([
        { hasSnapshot: true, snapshotSource: "server" },
        { hasSnapshot: false, snapshotSource: undefined },
      ]),
    ).toBe("server");
    expect(
      resolveStartupShellSnapshotSource([
        { hasSnapshot: true, snapshotSource: "server" },
        { hasSnapshot: true, snapshotSource: "cache" },
      ]),
    ).toBe("cache");
  });
});
