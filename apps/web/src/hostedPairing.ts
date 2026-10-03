import { HOSTED_APP_NIGHTLY_ORIGIN, HOSTED_APP_ORIGIN } from "@e6tools/shared/brand";
import { DEFAULT_HOSTED_APP_URL } from "@e6tools/shared/connectAuth";
import { readHostedPairingRequest as readSharedHostedPairingRequest } from "@e6tools/shared/remote";

import { setPairingTokenOnUrl } from "./pairingUrl";

export type HostedAppChannel = "latest" | "nightly";

const HOSTED_CHANNEL_ORIGIN = {
  latest: HOSTED_APP_ORIGIN,
  nightly: HOSTED_APP_NIGHTLY_ORIGIN,
} as const satisfies Record<HostedAppChannel, string>;

function configuredHostedAppUrl(): string {
  return import.meta.env.VITE_HOSTED_APP_URL?.trim() || DEFAULT_HOSTED_APP_URL;
}

function configuredBackendUrl(): string {
  return import.meta.env.VITE_HTTP_URL?.trim() || import.meta.env.VITE_WS_URL?.trim() || "";
}

function originFromUrl(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isHostedStaticApp(url?: URL): boolean {
  if (configuredBackendUrl()) {
    return false;
  }

  // No window, or a window without a location (tests, static render), means
  // no origin to be hosted at.
  if (url === undefined && (typeof window === "undefined" || window.location === undefined)) {
    return false;
  }

  const hostedOrigin = originFromUrl(configuredHostedAppUrl());
  return hostedOrigin !== null && (url ?? new URL(window.location.href)).origin === hostedOrigin;
}

export function readHostedPairingRequest(url: URL = new URL(window.location.href)) {
  return readSharedHostedPairingRequest(url);
}

export function hasHostedPairingRequest(url: URL = new URL(window.location.href)): boolean {
  return readHostedPairingRequest(url) !== null;
}

export function buildHostedPairingUrl(input: {
  readonly host: string;
  readonly token: string;
  readonly label?: string | null;
}): string {
  const url = new URL("/pair", configuredHostedAppUrl());
  const hashParams = new URLSearchParams();
  hashParams.set("host", input.host);
  const label = input.label?.trim();
  if (label) {
    hashParams.set("label", label);
  }
  url.hash = hashParams.toString();

  return setPairingTokenOnUrl(url, input.token).toString();
}

export function buildHostedChannelSelectionUrl(input: {
  readonly channel: HostedAppChannel;
}): string {
  // Each channel is its own host. The About panel opens that host directly.
  // Sign-in and pairing stay on the origin the user is leaving.
  return new URL("/", HOSTED_CHANNEL_ORIGIN[input.channel]).toString();
}
