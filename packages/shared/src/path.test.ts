// @effect-diagnostics nodeBuiltinImport:off - uses Node's own POSIX and Windows joins as callers do.
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";
import {
  expandHomePath,
  isExplicitRelativePath,
  isUncPath,
  isWindowsAbsolutePath,
  isWindowsDrivePath,
  normalizeProjectPathForComparison,
  normalizeProjectPathForDispatch,
} from "./path.ts";

describe("path helpers", () => {
  it("detects windows drive paths", () => {
    expect(isWindowsDrivePath("C:\\repo")).toBe(true);
    expect(isWindowsDrivePath("D:/repo")).toBe(true);
    expect(isWindowsDrivePath("/repo")).toBe(false);
  });

  it("detects UNC paths", () => {
    expect(isUncPath("\\\\server\\share\\repo")).toBe(true);
    expect(isUncPath("C:\\repo")).toBe(false);
  });

  it("detects windows absolute paths", () => {
    expect(isWindowsAbsolutePath("C:\\repo")).toBe(true);
    expect(isWindowsAbsolutePath("\\\\server\\share\\repo")).toBe(true);
    expect(isWindowsAbsolutePath("./repo")).toBe(false);
  });

  it("detects explicit relative paths", () => {
    expect(isExplicitRelativePath(".")).toBe(true);
    expect(isExplicitRelativePath("..")).toBe(true);
    expect(isExplicitRelativePath("./repo")).toBe(true);
    expect(isExplicitRelativePath("..\\repo")).toBe(true);
    expect(isExplicitRelativePath("~/repo")).toBe(false);
  });

  it("normalizes a bare Windows drive root the same as one with a trailing separator", () => {
    // `C:`, `C:\` and `C:/` all refer to the drive root and must compare equal.
    expect(normalizeProjectPathForDispatch("C:")).toBe("C:\\");
    expect(normalizeProjectPathForComparison("C:")).toBe("c:\\");
    expect(normalizeProjectPathForComparison("C:")).toBe(normalizeProjectPathForComparison("C:\\"));
    expect(normalizeProjectPathForComparison("C:")).toBe(normalizeProjectPathForComparison("C:/"));
    // Non-root drive paths keep their trailing separator trimmed as before.
    expect(normalizeProjectPathForDispatch("C:\\repo\\")).toBe("C:\\repo");
  });
});

describe("expandHomePath", () => {
  const posix = { homeDir: "/Users/me", join: NodePath.posix.join };
  const windows = { homeDir: "C:\\Users\\me", join: NodePath.win32.join };

  it("replaces a leading ~ with the home directory, with either separator", () => {
    expect(expandHomePath("~", posix)).toBe("/Users/me");
    expect(expandHomePath("~/e6-alt", posix)).toBe("/Users/me/e6-alt");
    expect(expandHomePath("~\\e6-alt", posix)).toBe("/Users/me/e6-alt");
    expect(expandHomePath("~\\e6-alt\\home", windows)).toBe("C:\\Users\\me\\e6-alt\\home");
  });

  it("leaves other paths, and another user's ~name, unchanged", () => {
    for (const input of ["/srv/e6", "e6-alt", "./~/e6", "~other/e6", "~e6", ""]) {
      expect(expandHomePath(input, posix), input).toBe(input);
    }
  });
});
