import { ENVIRONMENT_MACHINE_KINDS, type EnvironmentMachineKind } from "@e6tools/contracts";
import { ICONS, type IconEntry, type IconName } from "@e6tools/design-tokens/icons";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vite-plus/test";

import type { SymbolView } from "./AppSymbol";
import { androidSymbolCandidates, iosSymbolFor, type SfIconName } from "./appSymbolIcon";
import { environmentMachineIcon } from "./environmentMachineIcon";

/** The SF Symbol each machine kind drew before it moved to the registry. */
const MACHINE_SYMBOL_BEFORE: Record<EnvironmentMachineKind, string> = {
  server: "server.rack",
  cloud: "cloud",
  linux: "terminal",
  desktop: "desktopcomputer",
  laptop: "laptopcomputer",
  "mac-mini": "macmini",
  "mac-studio": "macstudio",
};

describe("environment machine icons", () => {
  it.each(ENVIRONMENT_MACHINE_KINDS)("draws %s with the symbol it drew before", (kind) => {
    const icon = environmentMachineIcon(kind);
    expect(iosSymbolFor(icon)).toBe(MACHINE_SYMBOL_BEFORE[kind]);
    expect(androidSymbolCandidates(icon)[0]).toBe(MACHINE_SYMBOL_BEFORE[kind]);
  });
});

describe("iosSymbolFor", () => {
  it.each([
    ["folder", "folder.fill"],
    ["star", "star.fill"],
    // Fills on iOS although web never fills it, as mobile's applied filter does today.
    ["filter", "line.3.horizontal.decrease.circle.fill"],
  ] as const)("draws an active %s as %s", (icon, symbol) => {
    expect(iosSymbolFor(icon, "active")).toBe(symbol);
  });

  it("draws an active icon without an SF fill as it draws at rest", () => {
    const withoutFill = (Object.keys(ICONS) as Array<IconName>).filter(
      (name): name is SfIconName => {
        const { sf } = ICONS[name] as IconEntry;
        return sf !== undefined && sf.fill === undefined;
      },
    );
    expect(withoutFill.length).toBeGreaterThan(0);
    for (const icon of withoutFill) {
      expect(iosSymbolFor(icon, "active"), icon).toBe(iosSymbolFor(icon));
    }
  });

  it("draws the regular symbol at rest", () => {
    expect(iosSymbolFor("folder")).toBe("folder");
    expect(iosSymbolFor("folder", "rest")).toBe("folder");
  });
});

describe("androidSymbolCandidates", () => {
  // Android draws the first candidate its Tabler map has.
  it("reaches an entry through its alias", () => {
    expect(androidSymbolCandidates("fast")).toEqual(["bolt", "bolt.circle"]);
  });

  it("falls back to the fill at rest, so stop keeps the filled glyph Android draws today", () => {
    expect(androidSymbolCandidates("stop")).toEqual(["stop", "stop.fill"]);
  });

  it("tries the fill first when active", () => {
    expect(androidSymbolCandidates("success", "active")).toEqual([
      "checkmark.circle.fill",
      "checkmark.circle",
    ]);
  });
});

describe("AppSymbol props", () => {
  type AppSymbolProps = ComponentProps<typeof SymbolView>;

  // tsc checks the directives: each fails the typecheck once the props it marks become valid.
  // `name` and `icon` are both optional (icon wins at runtime), not exclusive. Callers type their
  // own props as `ComponentProps<typeof SymbolView>["name"]`, which includes `undefined` once
  // `name` is optional, and an exclusive union rejects passing that value as `name`. So "both" and
  // "state with name" are not type errors until ENG-174 moves callers to `icon`.
  it("takes a registry name both platforms draw, or a symbol name", () => {
    const cases: ReadonlyArray<AppSymbolProps> = [
      { icon: "server", tintColorClassName: "text-foreground" },
      { icon: "folder", state: "active" },
      { name: "server.rack" },
      { name: { ios: "folder.fill", android: "folder_open" } },
      // @ts-expect-error An SF Symbol name is not a registry name.
      { icon: "server.rack" },
      // @ts-expect-error "brain" is an Android SF key, but the registry's brain has no SF Symbol.
      { icon: "brain" },
      // @ts-expect-error debug draws on iOS only, so Android could not draw it.
      { icon: "debug" },
      // @ts-expect-error A state is "rest" or "active".
      { icon: "folder", state: "selected" },
    ];
    expect(cases).toHaveLength(8);
  });
});
