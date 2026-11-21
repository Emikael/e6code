import { describe, expect, it } from "vite-plus/test";

import pickerNames from "./fixtures/lucide-0.564.0-picker-names.json" with { type: "json" };
import {
  PROJECT_ICON_DEFAULT,
  PROJECT_ICON_MAP_VERSION,
  PROJECT_ICONS,
  projectIconForLucideName,
} from "./projectIcons.ts";
import { ICONS } from "./registry.ts";

/**
 * Projects store the Lucide name their icon was picked by. The picker searched every name in
 * lucide-react 0.564.0 (the only version E6 shipped), so that list is the whole domain the map
 * must answer for: a curated icon, or null for the caller's favicon-or-folder fallback.
 */
const PICKER: Record<string, string> = pickerNames;

/** Today's empty-query grid (`POPULAR_PROJECT_ICONS` in apps/web/src/projectIconOptions.ts). */
const POPULAR = [
  "folder-code",
  "code-2",
  "terminal",
  "globe-2",
  "server",
  "database",
  "bot",
  "sparkles",
  "smartphone",
  "monitor",
  "cloud-cog",
  "package",
  "book-open",
  "flask-conical",
  "shield-check",
  "rocket",
  "gamepad-2",
  "music",
  "image",
  "shopping-bag",
  "git-branch",
  "workflow",
  "wrench",
  "layers-3",
];

describe("curated project icons", () => {
  it("offers about 120 registry icons, each once", () => {
    expect(PROJECT_ICONS.length).toBeGreaterThanOrEqual(100);
    expect(PROJECT_ICONS.length).toBeLessThanOrEqual(140);
    const icons = PROJECT_ICONS.map((entry) => entry.icon);
    expect(new Set(icons).size).toBe(icons.length);
    for (const entry of PROJECT_ICONS) {
      expect(ICONS, entry.icon).toHaveProperty(entry.icon);
      expect(entry.label.trim(), entry.icon).not.toBe("");
    }
  });

  it("opens on today's popular icons, in today's order", () => {
    expect(PROJECT_ICONS.slice(0, POPULAR.length).map((entry) => entry.lucide[0])).toEqual(POPULAR);
  });

  it("defaults to the first popular icon, the monogram wire fallback", () => {
    expect(PROJECT_ICON_DEFAULT).toBe(PROJECT_ICONS[0]!.icon);
    expect(projectIconForLucideName("folder-code")).toBe(PROJECT_ICON_DEFAULT);
  });
});

describe("Lucide project-icon map", () => {
  it("covers a frozen domain of 1,917 picker names", () => {
    expect(Object.keys(PICKER)).toHaveLength(1917);
    expect(new Set(Object.values(PICKER)).size).toBe(1671);
  });

  it("claims each picker name at most once, and only names the picker offered", () => {
    const claimed = PROJECT_ICONS.flatMap((entry) => entry.lucide);
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(claimed.filter((name) => !Object.hasOwn(PICKER, name))).toEqual([]);
  });

  it("maps every alias of an icon the same way as the icon", () => {
    for (const [name, canonical] of Object.entries(PICKER)) {
      expect(projectIconForLucideName(name), name).toBe(projectIconForLucideName(canonical));
    }
  });

  it("round-trips the name each curated icon is persisted under", () => {
    for (const entry of PROJECT_ICONS) {
      expect(projectIconForLucideName(entry.lucide[0]), entry.icon).toBe(entry.icon);
    }
  });

  it("answers null for names the picker never offered", () => {
    for (const name of ["", "constructor", "__proto__", "toString", "hasOwnProperty", "nope"]) {
      expect(projectIconForLucideName(name), name).toBeNull();
    }
  });

  // Every change to what a stored name shows is visible here; bump the version with it.
  it("matches the reviewed map", async () => {
    const map = Object.fromEntries(
      Object.keys(PICKER).map((name) => [name, projectIconForLucideName(name)]),
    );
    await expect(
      `${JSON.stringify({ version: PROJECT_ICON_MAP_VERSION, map }, null, 2)}\n`,
    ).toMatchFileSnapshot("./__snapshots__/projectIconMap.json");
  });
});
