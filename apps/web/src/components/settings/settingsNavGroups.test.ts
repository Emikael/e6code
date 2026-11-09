import { describe, expect, it } from "vite-plus/test";
import type { ConnectionTarget } from "@e6tools/client-runtime/connection";

import {
  groupSettingsNavItems,
  settingsConnectionsBadge,
  settingsProvidersBadge,
} from "./settingsNavGroups";
import { SETTINGS_SECTION_LABELS, type SettingsPath } from "./settingsSearch";

const ALL_PATHS = Object.keys(SETTINGS_SECTION_LABELS) as SettingsPath[];

describe("groupSettingsNavItems", () => {
  it("places every settings page under exactly one heading", () => {
    const groups = groupSettingsNavItems(ALL_PATHS.map((to) => ({ to })));
    const grouped = groups.flatMap((group) => group.items.map((item) => item.to));
    expect(grouped.toSorted()).toEqual(ALL_PATHS.toSorted());
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(groups.map((group) => [group.label, group.items.map((item) => item.to)])).toEqual([
      [
        "App",
        [
          "/settings/general",
          "/settings/appearance",
          "/settings/keybindings",
          "/settings/snap-shot",
        ],
      ],
      ["Agents", ["/settings/providers", "/settings/integrations"]],
      ["Projects", ["/settings/projects", "/settings/source-control"]],
      ["Environment", ["/settings/connections", "/settings/storage", "/settings/archived"]],
    ]);
  });

  it("drops hidden pages and headings left empty", () => {
    const groups = groupSettingsNavItems([
      { to: "/settings/archived" as const },
      { to: "/settings/general" as const },
    ]);
    expect(groups.map((group) => group.label)).toEqual(["App", "Environment"]);
  });
});

type ProviderInput = Parameters<typeof settingsProvidersBadge>[0][number];

function provider(
  enabled: boolean,
  installed: boolean,
  status: ProviderInput["auth"]["status"],
): ProviderInput {
  return { enabled, installed, auth: { status } };
}

describe("settingsProvidersBadge", () => {
  it("counts enabled, installed providers that are signed out", () => {
    expect(
      settingsProvidersBadge([
        provider(true, true, "unauthenticated"),
        provider(true, true, "authenticated"),
        provider(false, true, "unauthenticated"),
        provider(true, false, "unauthenticated"),
        provider(true, true, "unknown"),
      ]),
    ).toEqual({ text: "1 signed out", tone: "warning" });
  });

  it("shows nothing when every enabled provider is signed in", () => {
    expect(settingsProvidersBadge([provider(true, true, "authenticated")])).toBeNull();
    expect(settingsProvidersBadge([])).toBeNull();
  });
});

function environment(target: Record<string, string>) {
  return { entry: { target: target as unknown as ConnectionTarget } };
}

describe("settingsConnectionsBadge", () => {
  it("counts saved environments, not this server or desktop-local backends", () => {
    expect(
      settingsConnectionsBadge([
        environment({ _tag: "PrimaryConnectionTarget" }),
        environment({ _tag: "BearerConnectionTarget", connectionId: "local:wsl" }),
        environment({ _tag: "BearerConnectionTarget", connectionId: "remote-1" }),
        environment({ _tag: "SshConnectionTarget", connectionId: "ssh-1" }),
        environment({ _tag: "RelayConnectionTarget" }),
      ]),
    ).toEqual({ text: "3", tone: "muted" });
  });

  it("shows nothing without saved environments", () => {
    expect(settingsConnectionsBadge([environment({ _tag: "PrimaryConnectionTarget" })])).toBeNull();
  });
});
