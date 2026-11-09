import { describe, expect, it } from "vite-plus/test";
import type { ConnectionTarget } from "@e6tools/client-runtime/connection";

import {
  groupSettingsNavItems,
  SETTINGS_OVERLAY_SELECTOR,
  settingsConnectionsBadge,
  settingsEscapeAction,
  settingsNavGroupLabel,
  settingsPageHeading,
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

describe("settingsPageHeading", () => {
  it("gives every nav page a breadcrumb group, title, and subtitle", () => {
    for (const path of ALL_PATHS) {
      const heading = settingsPageHeading(path);
      expect(heading?.title).toBe(SETTINGS_SECTION_LABELS[path]);
      expect(heading?.group).toBe(settingsNavGroupLabel(path));
      expect(heading?.description).toBeTruthy();
    }
    expect(settingsPageHeading("/settings/appearance/")).toEqual({
      group: "App",
      title: "Appearance",
      description: "How E6 Code looks on this device. Changes apply as you make them.",
    });
  });

  it("files detail pages under their parent section's group", () => {
    expect(settingsPageHeading("/settings/diagnostics")).toMatchObject({
      group: "App",
      title: "Diagnostics",
    });
    expect(settingsNavGroupLabel("/settings/open-source-licenses")).toBe("App");
    expect(settingsPageHeading("/settings/unknown")).toBeNull();
    expect(settingsPageHeading("/")).toBeNull();
  });
});

function escapeTarget(tagName: string, { editable = false, overlay = false } = {}) {
  return {
    tagName,
    isContentEditable: editable,
    closest: (selector: string) => (overlay && selector === SETTINGS_OVERLAY_SELECTOR ? {} : null),
  };
}

describe("settingsEscapeAction", () => {
  it("leaves settings from the page itself", () => {
    expect(settingsEscapeAction(null)).toBe("leave");
    expect(settingsEscapeAction(escapeTarget("BODY"))).toBe("leave");
    expect(settingsEscapeAction(escapeTarget("BUTTON"))).toBe("leave");
  });

  it("only gives up focus from a text field", () => {
    expect(settingsEscapeAction(escapeTarget("INPUT"))).toBe("blur");
    expect(settingsEscapeAction(escapeTarget("TEXTAREA"))).toBe("blur");
    expect(settingsEscapeAction(escapeTarget("DIV", { editable: true }))).toBe("blur");
  });

  it("leaves Esc to open dialogs and popups", () => {
    expect(settingsEscapeAction(escapeTarget("INPUT", { overlay: true }))).toBe("ignore");
    expect(settingsEscapeAction(escapeTarget("BUTTON", { overlay: true }))).toBe("ignore");
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
    ).toEqual({ text: "1 signed out", label: "1 signed out", tone: "warning" });
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
    ).toEqual({ text: "3", label: "3 saved", tone: "muted" });
  });

  it("shows nothing without saved environments", () => {
    expect(settingsConnectionsBadge([environment({ _tag: "PrimaryConnectionTarget" })])).toBeNull();
  });
});
