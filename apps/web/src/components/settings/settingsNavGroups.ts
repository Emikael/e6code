import type { ConnectionTarget } from "@e6tools/client-runtime/connection";
import type { ServerProvider } from "@e6tools/contracts";

import { isDesktopLocalConnectionTarget } from "../../connection/desktopLocal";

import { SETTINGS_SECTION_LABELS, type SettingsPath } from "./settingsSearch";

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
      "/settings/attention",
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

/** Pages reached from a section rather than the nav; they sit under that section's heading. */
export const SETTINGS_DETAIL_PAGES: Readonly<
  Record<string, { readonly label: string; readonly parent: SettingsPath }>
> = {
  "/settings/diagnostics": { label: "Diagnostics", parent: "/settings/general" },
  "/settings/open-source-licenses": { label: "Open source licenses", parent: "/settings/general" },
};

const SETTINGS_PAGE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "/settings/general": "Threads, confirmations, text generation, and updates.",
  "/settings/appearance": "How E6 Code looks on this device. Changes apply as you make them.",
  "/settings/attention":
    "How much E6 Code asks of your attention. Pick a starting point, then change anything below.",
  "/settings/keybindings": "Shortcuts for commands across the app.",
  "/settings/snap-shot": "Capture windows into a draft without leaving what you are doing.",
  "/settings/providers": "Sign in to agents and choose the models they offer.",
  "/settings/integrations": "Browser and device access agents can use.",
  "/settings/projects": "Settings for the selected project and its checkouts.",
  "/settings/source-control":
    "Source control providers and the commit and pull request text agents write.",
  "/settings/storage": "How long worktrees, artifacts, and logs are kept.",
  "/settings/connections":
    "Environments this client reaches, and the clients paired with this one.",
  "/settings/archived": "Archived threads. Restore one to bring it back to the sidebar.",
  "/settings/diagnostics": "Recent failures, slow spans, and logs from the server.",
  "/settings/open-source-licenses": "Licenses for the open source software E6 Code ships with.",
};

function normalizeSettingsPathname(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function isSettingsPath(pathname: string): pathname is SettingsPath {
  return Object.hasOwn(SETTINGS_SECTION_LABELS, pathname);
}

/** The nav heading a settings page sits under, following detail pages to their section. */
export function settingsNavGroupLabel(pathname: string): string | null {
  const normalized = normalizeSettingsPathname(pathname);
  const path = isSettingsPath(normalized) ? normalized : SETTINGS_DETAIL_PAGES[normalized]?.parent;
  if (!path) return null;
  return SETTINGS_NAV_GROUPS.find((group) => group.paths.includes(path))?.label ?? null;
}

export interface SettingsPageHeading {
  /** The nav heading, read as the breadcrumb `Settings / <group>`. */
  readonly group: string;
  readonly title: string;
  readonly description: string;
}

/** Breadcrumb, title, and subtitle for the header at the top of a settings page. */
export function settingsPageHeading(pathname: string): SettingsPageHeading | null {
  const normalized = normalizeSettingsPathname(pathname);
  const title = isSettingsPath(normalized)
    ? SETTINGS_SECTION_LABELS[normalized]
    : SETTINGS_DETAIL_PAGES[normalized]?.label;
  const group = settingsNavGroupLabel(normalized);
  const description = SETTINGS_PAGE_DESCRIPTIONS[normalized];
  if (!title || !group || !description) return null;
  return { group, title, description };
}

/**
 * What Esc does on a settings page. Overlays own their Esc; a focused text
 * field gives up focus first, so a second press is needed to leave settings.
 */
export function settingsEscapeAction(
  target: {
    readonly tagName: string;
    readonly isContentEditable: boolean;
    closest(selector: string): unknown;
  } | null,
): "ignore" | "blur" | "leave" {
  if (target === null) return "leave";
  if (target.closest(SETTINGS_OVERLAY_SELECTOR) !== null) return "ignore";
  if (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  ) {
    return "blur";
  }
  return "leave";
}

/** Open dialogs and popups, whose focus trap and Esc handling come first. */
export const SETTINGS_OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [data-slot$="popup"]';

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
