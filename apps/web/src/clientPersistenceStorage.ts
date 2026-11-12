import {
  carryRetiredClientSettings,
  ClientSettingsSchema,
  type ClientSettings,
} from "@e6tools/contracts";
import * as Schema from "effect/Schema";

import {
  getLocalStorageItem,
  LocalStorageOperationError,
  setLocalStorageItem,
} from "./hooks/useLocalStorage";

const CLIENT_SETTINGS_STORAGE_KEY = "e6code:client-settings:v1";
const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

export function readBrowserClientSettings(): ClientSettings | null {
  if (!hasWindow()) {
    return null;
  }

  const stored = getLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, Schema.Unknown);
  if (stored === null) return null;
  try {
    return decodeClientSettings(carryRetiredClientSettings(stored));
  } catch (cause) {
    throw new LocalStorageOperationError({
      operation: "decode",
      storageKey: CLIENT_SETTINGS_STORAGE_KEY,
      cause,
    });
  }
}

export function writeBrowserClientSettings(settings: ClientSettings): void {
  if (!hasWindow()) {
    return;
  }

  setLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, settings, ClientSettingsSchema);
}

/**
 * The boot script in index.html paints the stored accent and contrast before
 * the app loads, from localStorage. Desktop keeps client settings in a file
 * the page cannot read that early, so every load and save mirrors the two
 * values here, on web and desktop alike. Keep the key in sync with index.html.
 */
const BOOT_APPEARANCE_STORAGE_KEY = "e6code:boot-appearance:v1";

export function mirrorBootAppearance(settings: ClientSettings | null): void {
  if (!hasWindow()) {
    return;
  }
  try {
    if (settings === null) {
      window.localStorage.removeItem(BOOT_APPEARANCE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      BOOT_APPEARANCE_STORAGE_KEY,
      JSON.stringify({
        stockAccent: settings.stockAccent,
        appearanceContrast: settings.appearanceContrast,
      }),
    );
  } catch {
    // Storage can be unavailable; the boot script then shows the defaults.
  }
}
