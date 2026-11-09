import { describe, expect, it } from "vite-plus/test";

import { deriveWorkStepMeta, resolveWorkRowStats } from "./stepMeta.ts";

describe("deriveWorkStepMeta", () => {
  const settled = {
    createdAt: "2026-02-23T00:00:02.200Z",
    startedAt: "2026-02-23T00:00:01.000Z",
    toolLifecycleStatus: "completed" as const,
  };

  it("times a settled step from its first lifecycle row to its last", () => {
    expect(deriveWorkStepMeta(settled)).toEqual({ duration: "1.2s", diffStat: null });
    expect(deriveWorkStepMeta({ ...settled, toolLifecycleStatus: "failed" }).duration).toBe("1.2s");
  });

  it("does not time a running step or one without a start", () => {
    expect(
      deriveWorkStepMeta({ ...settled, toolLifecycleStatus: "inProgress" }).duration,
    ).toBeNull();
    expect(
      deriveWorkStepMeta({ createdAt: settled.createdAt, toolLifecycleStatus: "completed" })
        .duration,
    ).toBeNull();
    expect(
      deriveWorkStepMeta({ createdAt: settled.createdAt, startedAt: settled.startedAt }).duration,
    ).toBeNull();
  });

  it("ignores spans that run backwards or do not parse", () => {
    expect(
      deriveWorkStepMeta({ ...settled, startedAt: "2026-02-23T00:00:03.000Z" }).duration,
    ).toBeNull();
    expect(deriveWorkStepMeta({ ...settled, startedAt: "not a time" }).duration).toBeNull();
  });

  it("shows line changes, but not an empty change", () => {
    expect(deriveWorkStepMeta({ ...settled, diffStat: { additions: 48, deletions: 12 } })).toEqual({
      duration: "1.2s",
      diffStat: { additions: 48, deletions: 12 },
    });
    expect(
      deriveWorkStepMeta({
        createdAt: settled.createdAt,
        diffStat: { additions: 0, deletions: 0 },
      }),
    ).toEqual({ duration: null, diffStat: null });
  });
});

describe("resolveWorkRowStats", () => {
  const entry = {
    createdAt: "2026-02-23T00:00:02.200Z",
    startedAt: "2026-02-23T00:00:01.000Z",
    toolLifecycleStatus: "completed" as const,
    diffStat: { additions: 48, deletions: 12 },
  };

  it("puts the diff stat in exactly one place", () => {
    for (const timeline of [true, false]) {
      const { meta, inlineDiffStat } = resolveWorkRowStats(entry, timeline);
      const shown = [meta?.diffStat, inlineDiffStat].filter(Boolean);
      expect(shown).toEqual([{ additions: 48, deletions: 12 }]);
    }
  });

  it("uses the timeline meta when the setting is on, the inline label when it is off", () => {
    expect(resolveWorkRowStats(entry, true)).toEqual({
      meta: { duration: "1.2s", diffStat: { additions: 48, deletions: 12 } },
      inlineDiffStat: null,
    });
    expect(resolveWorkRowStats(entry, false)).toEqual({
      meta: null,
      inlineDiffStat: { additions: 48, deletions: 12 },
    });
  });

  it("shows nothing when there is nothing to show", () => {
    const bare = { createdAt: entry.createdAt };
    expect(resolveWorkRowStats(bare, true)).toEqual({ meta: null, inlineDiffStat: null });
    expect(resolveWorkRowStats(bare, false)).toEqual({ meta: null, inlineDiffStat: null });
  });
});
