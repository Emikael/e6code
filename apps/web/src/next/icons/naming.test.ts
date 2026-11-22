import { ICONS } from "@e6tools/design-tokens/icons";
import { describe, expect, it } from "vite-plus/test";

import { iconComponentName, lazyIconModulePath } from "./naming.ts";

const names = Object.keys(ICONS);

describe("icon component names", () => {
  it.each([
    ["chevron-down", "IconChevronDown"],
    ["add", "IconAdd"],
    ["mac-mini", "IconMacMini"],
  ])("names %s %s", (name, component) => {
    expect(iconComponentName(name)).toBe(component);
  });

  it("gives every registry entry a valid identifier", () => {
    const invalid = names.filter(
      (name) => !/^Icon[A-Z][A-Za-z0-9]*$/.test(iconComponentName(name)),
    );
    expect(invalid).toEqual([]);
  });

  // macOS and Windows filesystems ignore case, so two modules differing only by case would collide.
  it("gives every registry entry a file name that is unique ignoring case", () => {
    const seen = new Map<string, string>();
    const collisions = names.flatMap((name) => {
      const key = iconComponentName(name).toLowerCase();
      const other = seen.get(key);
      seen.set(key, name);
      return other === undefined ? [] : [`${other} and ${name}`];
    });
    expect(collisions).toEqual([]);
  });

  it("finds a lazy module by its component name in the lazy folder", () => {
    expect(lazyIconModulePath("chevron-down")).toBe("./generated/lazy/IconChevronDown.tsx");
  });
});
