import { UsageDay } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { describePeriodChange, modelCostSplit, previousWindow } from "./usageInsights";

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

describe("modelCostSplit", () => {
  const model = (name: string, costUsd: number, unpricedRecords = 0) => ({
    model: name,
    provider: "codex" as const,
    costUsd,
    totalTokens: 1_000,
    records: 2,
    unpricedRecords,
    costShare: 0,
  });

  it("orders models by cost with percents that add up to 100", () => {
    const { parts } = modelCostSplit([model("small", 1), model("large", 2)]);

    expect(parts.map((part) => [part.label, part.percent])).toEqual([
      ["large", 67],
      ["small", 33],
    ]);
  });

  it("folds models past the limit into one remainder", () => {
    const { parts } = modelCostSplit(
      [model("a", 50), model("b", 20), model("c", 10), model("d", 5)],
      2,
    );

    expect(parts.map((part) => part.label)).toEqual(["a", "b", "2 other models"]);
    expect(parts[2]).toMatchObject({ provider: null, costUsd: 15, percent: 18 });
  });

  it("names a single model past the limit instead of folding it", () => {
    const { parts } = modelCostSplit([model("a", 3), model("b", 2), model("c", 1)], 2);

    expect(parts.map((part) => part.label)).toEqual(["a", "b", "c"]);
  });

  it("counts unpriced models apart rather than as free", () => {
    const { parts, unpricedModels } = modelCostSplit([model("priced", 4), model("unknown", 0, 2)]);

    expect(parts.map((part) => part.label)).toEqual(["priced"]);
    expect(unpricedModels).toBe(1);
  });
});
