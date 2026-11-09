import { UsageDay } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { describePeriodChange, previousWindow, sharePercents } from "./usageInsights";

describe("previousWindow", () => {
  it("covers the same number of calendar days just before the window", () => {
    expect(
      previousWindow({
        sinceDay: UsageDay.make("2026-11-03"),
        untilDay: UsageDay.make("2026-11-09"),
        timeZone: "UTC",
        resolution: "day",
      }),
    ).toEqual({
      sinceDay: "2026-10-27",
      untilDay: "2026-11-02",
      timeZone: "UTC",
      resolution: "day",
    });
  });

  it("crosses month and year boundaries", () => {
    const previous = previousWindow({
      sinceDay: UsageDay.make("2026-01-01"),
      untilDay: UsageDay.make("2026-01-30"),
      timeZone: "UTC",
    });
    expect([previous.sinceDay, previous.untilDay]).toEqual(["2025-12-02", "2025-12-31"]);
  });

  it("ends a rolling 24-hour window where the current one starts", () => {
    const previous = previousWindow({
      sinceDay: UsageDay.make("2026-11-08"),
      untilDay: UsageDay.make("2026-11-09"),
      timeZone: "America/New_York",
      resolution: "hour",
      sinceTime: "2026-11-08T15:00:00.000Z",
      untilTime: "2026-11-09T15:00:00.000Z",
    });
    expect(previous).toMatchObject({
      sinceTime: "2026-11-07T15:00:00.000Z",
      untilTime: "2026-11-08T15:00:00.000Z",
      sinceDay: "2026-11-07",
      untilDay: "2026-11-08",
    });
  });
});

describe("describePeriodChange", () => {
  it("words growth and decline as rounded percentages", () => {
    expect(describePeriodChange(112, 100, "7 days")).toEqual({
      direction: "more",
      text: "12% more than the 7 days before",
    });
    expect(describePeriodChange(60, 80, "30 days")).toEqual({
      direction: "less",
      text: "25% less than the 30 days before",
    });
  });

  it("calls changes within three percent about the same", () => {
    expect(describePeriodChange(103, 100, "7 days")?.direction).toBe("same");
    expect(describePeriodChange(97, 100, "7 days")?.text).toBe(
      "About the same as the 7 days before",
    );
    expect(describePeriodChange(104, 100, "7 days")?.direction).toBe("more");
    expect(describePeriodChange(96, 100, "7 days")?.direction).toBe("less");
  });

  it("has nothing to say when the previous window was empty", () => {
    expect(describePeriodChange(50, 0, "7 days")).toBeNull();
  });
});

describe("sharePercents", () => {
  it("rounds by largest remainder so the shares add up to 100", () => {
    expect(sharePercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(sharePercents([21.4, 19.85, 6.95])).toEqual([44, 41, 15]);
    const shares = sharePercents([0.333, 0.333, 0.334, 5, 7]);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(100);
  });

  it("keeps a provider with nothing at zero", () => {
    expect(sharePercents([10, 0])).toEqual([100, 0]);
  });

  it("gives all zeros when there is nothing to share", () => {
    expect(sharePercents([0, 0])).toEqual([0, 0]);
    expect(sharePercents([])).toEqual([]);
  });
});
