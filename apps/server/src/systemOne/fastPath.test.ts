import { describe, expect, it } from "@effect/vitest";

import { FAST_PATH_MAX_RECORDS, trimForFastPath } from "./fastPath.ts";

describe("trimForFastPath", () => {
  it("passes small inputs through untouched", () => {
    const records = ["a", "b"];
    expect(trimForFastPath("hello", records)).toEqual({
      text: "hello",
      records,
      trimmed: false,
      droppedRecords: 0,
      textCharsSaved: 0,
    });
  });

  it("drops the oldest records first", () => {
    const records = Array.from({ length: FAST_PATH_MAX_RECORDS + 3 }, (_, index) => `r${index}`);
    const trimmed = trimForFastPath("hello", records);
    expect(trimmed.records).toEqual(records.slice(3));
    expect(trimmed.droppedRecords).toBe(3);
    expect(trimmed.trimmed).toBe(true);
    expect(trimmed.text).toBe("hello");
  });

  it("keeps a long live message intact", () => {
    const text = "x".repeat(20_000);
    const trimmed = trimForFastPath(text, []);
    expect(trimmed.text).toBe(text);
    expect(trimmed.textCharsSaved).toBe(0);
    expect(trimmed.trimmed).toBe(false);
  });
});
