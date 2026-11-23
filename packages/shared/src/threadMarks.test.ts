import { describe, expect, it } from "vite-plus/test";

import {
  nextThreadMarks,
  parseThreadMark,
  THREAD_MARK_PREFIX,
  threadLiveMark,
  threadMarkProgress,
  threadRowsMark,
} from "./threadMarks.ts";

const NONE = { rows: false, live: false };

describe("thread mark names", () => {
  it("share the thread prefix", () => {
    expect(THREAD_MARK_PREFIX).toBe("e6:thread:");
    expect(threadRowsMark("cached")).toBe("e6:thread:rows:cached");
    expect(threadRowsMark("synchronizing")).toBe("e6:thread:rows:synchronizing");
    expect(threadRowsMark("live")).toBe("e6:thread:rows:live");
    expect(threadLiveMark()).toBe("e6:thread:live");
  });

  it("parse back to what they describe", () => {
    expect(parseThreadMark("e6:thread:rows:synchronizing")).toEqual({
      kind: "rows",
      status: "synchronizing",
    });
    expect(parseThreadMark("e6:thread:live")).toEqual({ kind: "live" });
    expect(parseThreadMark("e6:thread:rows:empty")).toBeNull();
    expect(parseThreadMark("e6:startup:shell-live")).toBeNull();
  });
});

describe("nextThreadMarks", () => {
  it("marks nothing until the routed thread shows rows", () => {
    expect(nextThreadMarks({ status: "synchronizing", hasRows: false, marked: NONE })).toEqual([]);
    expect(nextThreadMarks({ status: "live", hasRows: false, marked: NONE })).toEqual([]);
  });

  it("marks the first rows with the status they were shown in", () => {
    expect(nextThreadMarks({ status: "cached", hasRows: true, marked: NONE })).toEqual([
      "e6:thread:rows:cached",
    ]);
    expect(nextThreadMarks({ status: "synchronizing", hasRows: true, marked: NONE })).toEqual([
      "e6:thread:rows:synchronizing",
    ]);
  });

  it("reads rows remembered before the thread has any state as cached", () => {
    expect(nextThreadMarks({ status: "empty", hasRows: true, marked: NONE })).toEqual([
      "e6:thread:rows:cached",
    ]);
  });

  it("marks rows and live together when the first rows arrive live", () => {
    expect(nextThreadMarks({ status: "live", hasRows: true, marked: NONE })).toEqual([
      "e6:thread:rows:live",
      "e6:thread:live",
    ]);
  });

  it("marks live once the thread with rows catches up", () => {
    expect(
      nextThreadMarks({ status: "live", hasRows: true, marked: { rows: true, live: false } }),
    ).toEqual(["e6:thread:live"]);
  });

  it("never repeats a mark", () => {
    expect(
      nextThreadMarks({ status: "live", hasRows: true, marked: { rows: true, live: true } }),
    ).toEqual([]);
    expect(
      nextThreadMarks({ status: "cached", hasRows: true, marked: { rows: true, live: false } }),
    ).toEqual([]);
  });

  it("never marks a deleted thread", () => {
    expect(nextThreadMarks({ status: "deleted", hasRows: true, marked: NONE })).toEqual([]);
  });
});

describe("threadMarkProgress", () => {
  it("reads which kinds the marks set or still scheduled cover", () => {
    expect(threadMarkProgress([])).toEqual(NONE);
    expect(threadMarkProgress(["e6:thread:rows:synchronizing"])).toEqual({
      rows: true,
      live: false,
    });
    expect(threadMarkProgress(["e6:thread:rows:live", "e6:thread:live"])).toEqual({
      rows: true,
      live: true,
    });
    expect(threadMarkProgress(["e6:startup:shell-live", "e6:thread:rows:empty"])).toEqual(NONE);
  });

  it("offers a mark again once it was cancelled before it landed", () => {
    const scheduled = new Set<string>();
    const offer = () =>
      nextThreadMarks({ status: "live", hasRows: true, marked: threadMarkProgress(scheduled) });
    for (const name of offer()) scheduled.add(name);
    expect(offer()).toEqual([]);
    // StrictMode's replayed mount cancels both before the next frame.
    scheduled.clear();
    expect(offer()).toEqual(["e6:thread:rows:live", "e6:thread:live"]);
  });
});
