import { describe, expect, it } from "vite-plus/test";

import {
  areNamesConfusable,
  diffRailRows,
  fileCountLabel,
  generatedFoldLabel,
  isFileRailOpen,
  visibleRailRows,
} from "./diffFileRail.logic";

const file = (path: string) => ({ path, additions: 1, deletions: 0 });

describe("isFileRailOpen", () => {
  it("opens at 720px and wider until the user chooses", () => {
    expect(isFileRailOpen(null, 720)).toBe(true);
    expect(isFileRailOpen(null, 719)).toBe(false);
  });

  it("keeps the user's choice at any width", () => {
    expect(isFileRailOpen(false, 1200)).toBe(false);
    expect(isFileRailOpen(true, 400)).toBe(true);
  });
});

describe("areNamesConfusable", () => {
  it("matches the same name and names one letter apart", () => {
    expect(areNamesConfusable("index.ts", "index.ts")).toBe(true);
    expect(areNamesConfusable("themePalettes.ts", "themePalette.ts")).toBe(true);
    expect(areNamesConfusable("theme.ts", "thyme.ts")).toBe(true);
  });

  it("leaves distinct names alone", () => {
    expect(areNamesConfusable("index.css", "mobileTheme.ts")).toBe(false);
    expect(areNamesConfusable("ab.ts", "ba.ts")).toBe(false);
  });
});

describe("diffRailRows", () => {
  it("keeps the given order and names only the folders that tell files apart", () => {
    const rows = diffRailRows([
      file("apps/web/src/index.css"),
      file("packages/shared/src/themePalettes.ts"),
      file("apps/web/src/themePalette.ts"),
    ]);
    expect(rows.map((row) => [row.name, row.folder])).toEqual([
      ["index.css", null],
      ["themePalettes.ts", "shared"],
      ["themePalette.ts", "web"],
    ]);
  });

  it("names no folder when the files share one", () => {
    const rows = diffRailRows([file("src/theme.ts"), file("src/thyme.ts")]);
    expect(rows.map((row) => row.folder)).toEqual([null, null]);
  });

  it("marks lockfiles and build output as generated", () => {
    const rows = diffRailRows([file("src/a.ts"), file("pnpm-lock.yaml"), file("dist/a.js")]);
    expect(rows.map((row) => row.generated)).toEqual([false, true, true]);
  });
});

describe("visibleRailRows", () => {
  const rows = diffRailRows([file("pnpm-lock.yaml"), file("src/a.ts"), file("src/b.ts")]);

  it("folds generated files and counts them", () => {
    const view = visibleRailRows(rows, false);
    expect(view.rows.map((row) => row.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(view.generatedCount).toBe(1);
  });

  it("shows them in body order once opened", () => {
    expect(visibleRailRows(rows, true).rows.map((row) => row.path)).toEqual([
      "pnpm-lock.yaml",
      "src/a.ts",
      "src/b.ts",
    ]);
  });
});

describe("labels", () => {
  it("counts files and generated files", () => {
    expect(fileCountLabel(1)).toBe("1 file");
    expect(fileCountLabel(5)).toBe("5 files");
    expect(generatedFoldLabel(1, false)).toBe("1 generated file hidden");
    expect(generatedFoldLabel(2, true)).toBe("2 generated files shown");
  });
});
