import { ClientSettingsSchema, type ClientSettings } from "@e6tools/contracts";

import { getLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";

const CLIENT_SETTINGS_STORAGE_KEY = "e6code:client-settings:v1";

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

export function readBrowserClientSettings(): ClientSettings | null {
  if (!hasWindow()) {
    return null;
  }

  return getLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, ClientSettingsSchema);
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
