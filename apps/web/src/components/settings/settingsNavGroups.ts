import type { ConnectionTarget } from "@e6tools/client-runtime/connection";
import type { ServerProvider } from "@e6tools/contracts";

import { isDesktopLocalConnectionTarget } from "../../connection/desktopLocal";

import type { SettingsPath } from "./settingsSearch";

/**
 * Headings for the settings sidebar. Order here is render order, and each
 * group keeps its pages in the order they appear in the list.
 */
const SETTINGS_NAV_GROUPS: ReadonlyArray<{
  readonly label: string;
  readonly paths: ReadonlyArray<SettingsPath>;
}> = [
  {
    label: "App",
    paths: [
      "/settings/general",
      "/settings/appearance",
      "/settings/keybindings",
      "/settings/snap-shot",
    ],
  },
  { label: "Agents", paths: ["/settings/providers", "/settings/integrations"] },
  { label: "Projects", paths: ["/settings/projects", "/settings/source-control"] },
  {
    label: "Environment",
    paths: ["/settings/connections", "/settings/storage", "/settings/archived"],
  },
];

/**
 * Splits the visible nav items into their headings, dropping headings whose
 * pages are all hidden (the Project page only shows inside a project scope).
 */
export function groupSettingsNavItems<Item extends { readonly to: SettingsPath }>(
  items: ReadonlyArray<Item>,
): ReadonlyArray<{ readonly label: string; readonly items: ReadonlyArray<Item> }> {
  const byPath = new Map(items.map((item) => [item.to, item]));
  return SETTINGS_NAV_GROUPS.flatMap((group) => {
    const groupItems = group.paths.flatMap((path) => {
      const item = byPath.get(path);
      return item ? [item] : [];
    });
    return groupItems.length > 0 ? [{ label: group.label, items: groupItems }] : [];
  });
}

interface SettingsNavBadge {
  readonly text: string;
  /** Read in place of `text` when the visible text is a bare number. */
  readonly label: string;
  readonly tone: "muted" | "warning";
}

/**
 * Counts enabled, installed providers the server reports as signed out —
 * the same condition the Providers page headlines as "Not authenticated".
 */
export function settingsProvidersBadge(
  providers: ReadonlyArray<Pick<ServerProvider, "enabled" | "installed" | "auth">>,
): SettingsNavBadge | null {
  const signedOut = providers.filter(
    (provider) =>
      provider.enabled && provider.installed && provider.auth.status === "unauthenticated",
  ).length;
  return signedOut > 0
    ? { text: `${signedOut} signed out`, label: `${signedOut} signed out`, tone: "warning" }
    : null;
}

/**
 * Counts the saved environments the Connections page lists: everything except
 * this server itself and desktop-managed local backends (WSL), which have no
 * row of their own there.
 */
export function settingsConnectionsBadge(
  environments: ReadonlyArray<{ readonly entry: { readonly target: ConnectionTarget } }>,
): SettingsNavBadge | null {
  const count = environments.filter(
    ({ entry }) =>
      entry.target._tag !== "PrimaryConnectionTarget" &&
      !isDesktopLocalConnectionTarget(entry.target),
  ).length;
  return count > 0 ? { text: String(count), label: `${count} saved`, tone: "muted" } : null;
}
