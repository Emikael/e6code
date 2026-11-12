import { describe, expect, it } from "vite-plus/test";

import {
  areNamesConfusable,
  diffRailRows,
  fileCountLabel,
  generatedFoldLabel,
  inDiffOrder,
  isFileRailOpen,
  railFolderHints,
  foldGeneratedFiles,
  listedDiffFileCount,
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
});

describe("foldGeneratedFiles", () => {
  const paths = ["pnpm-lock.yaml", "src/a.ts", "src/b.ts"];

  it("folds generated files out and counts them", () => {
    const view = foldGeneratedFiles(paths, (path) => path, false);
    expect(view.items).toEqual(["src/a.ts", "src/b.ts"]);
    expect(view.generatedCount).toBe(1);
  });

  it("treats lockfiles and build output as generated", () => {
    expect(
      foldGeneratedFiles(["src/a.ts", "pnpm-lock.yaml", "dist/a.js"], (path) => path, false),
    ).toEqual({ items: ["src/a.ts"], generatedCount: 2 });
  });

  it("brings them back in body order once shown", () => {
    expect(foldGeneratedFiles(paths, (path) => path, true).items).toEqual(paths);
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

describe("inDiffOrder", () => {
  it("lists entries as the diff body does, with the rest after in their own order", () => {
    const entries = [{ path: "b.ts" }, { path: "z.ts" }, { path: "a.ts" }, { path: "y.ts" }];
    expect(inDiffOrder(entries, ["a.ts", "b.ts"]).map((entry) => entry.path)).toEqual([
      "a.ts",
      "b.ts",
      "z.ts",
      "y.ts",
    ]);
  });
});

describe("railFolderHints", () => {
  it("does not take swapped letters for one edit", () => {
    expect([...railFolderHints(["a/ab.ts", "b/ba.ts"]).values()]).toEqual([null, null]);
  });

  it("names the folder for names one letter apart", () => {
    const hints = railFolderHints([
      "packages/shared/src/themePalettes.ts",
      "apps/web/src/themePalette.ts",
      "apps/web/src/other.ts",
    ]);
    expect([...hints.values()]).toEqual(["shared", "web", null]);
  });
});

describe("listedDiffFileCount", () => {
  it("counts the files the Diff lists, leaving folded generated files out", () => {
    expect(listedDiffFileCount([{ path: "src/a.ts" }, { path: "pnpm-lock.yaml" }])).toBe(1);
  });
});
