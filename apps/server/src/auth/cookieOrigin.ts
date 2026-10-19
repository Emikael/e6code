/**
 * Cookie sessions are scoped to a hostname, not a port. `SameSite=Lax` still
 * sends them on same-site requests, and a WebSocket upgrade is not a CORS
 * request, so a page on another localhost port can present the session cookie.
 * State-changing cookie requests therefore need a trusted `Origin`.
 *
 * Bearer tokens, DPoP proofs, and WebSocket tickets are not ambient browser
 * credentials. Callers that authenticate with those may omit `Origin`.
 */
import { isTailscaleIpv4Address } from "@e6tools/tailscale";
import { HOSTED_APP_NIGHTLY_ORIGIN, HOSTED_APP_ORIGIN } from "@e6tools/shared/brand";
import * as NodeOS from "node:os";

export const DESKTOP_RENDERER_ORIGINS = ["e6code://app", "e6code-dev://app"] as const;

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const CONFIGURED_FETCH_SITES = new Set(["same-origin", "same-site", "cross-site"]);
const TAILSCALE_IPV6_PREFIX = "fd7a:115c:a1e0:";

export function cookieCredentialRequiresTrustedOrigin(input: {
  readonly method: string | undefined;
  readonly upgrade: string | undefined;
}): boolean {
  const upgrade = input.upgrade?.split(",")[0]?.trim().toLowerCase();
  if (upgrade === "websocket") {
    return true;
  }
  const method = input.method?.trim().toUpperCase();
  if (method === undefined || method.length === 0) {
    return false;
  }
  return !SAFE_HTTP_METHODS.has(method);
}

/**
 * Node's `URL.origin` is the string `"null"` for the desktop standard schemes.
 * Chromium, which registers them as standard schemes, sends `e6code://app`.
 */
export function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === "null" || trimmed.includes(",")) {
    return null;
  }
  const desktop = /^(e6code(?:-dev)?):\/\/([a-z0-9.-]+)\/?$/i.exec(trimmed);
  if (desktop?.[1] !== undefined && desktop[2] !== undefined) {
    return `${desktop[1].toLowerCase()}://${desktop[2].toLowerCase()}`;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (!url.origin || url.origin === "null") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/** An https origin with no path, query, or fragment. Anything else is ignored. */
export function hostedAppCookieOrigin(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const url = new URL(trimmed);
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.pathname !== "/" ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

export function hostedAppCookieOrigins(input: {
  readonly connectEnabled: boolean;
  readonly hostedAppOrigin: string | undefined;
}): ReadonlyArray<string> {
  if (!input.connectEnabled) {
    return [];
  }
  const origins = [HOSTED_APP_ORIGIN, HOSTED_APP_NIGHTLY_ORIGIN];
  const configured = hostedAppCookieOrigin(input.hostedAppOrigin);
  if (configured && !origins.includes(configured)) {
    origins.push(configured);
  }
  return origins;
}

export function devAllowedCookieOrigins(input: {
  readonly origins: ReadonlyArray<string>;
  readonly devUrl: URL | undefined;
}): {
  readonly trusted: ReadonlyArray<string>;
  readonly ignoredLoopback: ReadonlyArray<string>;
} {
  const trusted: Array<string> = [];
  const ignoredLoopback: Array<string> = [];
  for (const origin of input.origins) {
    if (input.devUrl === undefined && isLoopbackOrigin(origin)) {
      ignoredLoopback.push(origin);
      continue;
    }
    trusted.push(origin);
  }
  return { trusted, ignoredLoopback };
}

export function hasTailscaleInterfaceAddress(addresses: ReadonlyArray<string>): boolean {
  return addresses.some((address) => isTailscaleIpv4Address(address) || isTailscaleIpv6(address));
}

export function readNetworkInterfaceAddresses(): ReadonlyArray<string> {
  return Object.values(NodeOS.networkInterfaces()).flatMap(
    (entries) => entries?.map((entry) => entry.address) ?? [],
  );
}

export interface CookieOriginRequest {
  readonly originHeader: string | undefined;
  readonly secFetchSite: string | undefined;
  readonly hostHeader: string | undefined;
  readonly originalUrl: string | undefined;
  readonly forwardedProto: string | undefined;
  readonly bindHost: string | undefined;
  readonly devUrl: URL | undefined;
  readonly devAllowedOrigins: ReadonlyArray<string>;
  readonly hostedAppOrigins: ReadonlyArray<string>;
  readonly tailscaleServeEnabled: boolean;
  readonly tailscaleServePort: number;
  readonly magicDnsNames: ReadonlyArray<string>;
  readonly interfaceAddresses: ReadonlyArray<string>;
  readonly hostname: string;
}

export function isTrustedCookieOrigin(input: CookieOriginRequest): boolean {
  const origin = input.originHeader === undefined ? null : normalizeOrigin(input.originHeader);
  if (origin === null) {
    return false;
  }
  const site = normalizeFetchSite(input.secFetchSite);
  if (collectPrivilegedOrigins(input).has(origin)) {
    return site === undefined || CONFIGURED_FETCH_SITES.has(site);
  }
  // Operator-supplied origins are a same-origin allowlist. `same-site` would
  // re-open the other-port cookie attack on whatever host was listed.
  if (collectDevAllowedOrigins(input).has(origin)) {
    return site === undefined || site === "same-origin";
  }
  if (collectTailscaleServeOrigins(input).has(origin)) {
    // The browser page is that Tailscale origin, so the upgrade is same-origin
    // from its point of view even when the proxy rewrites Host to loopback.
    return site === undefined || site === "same-origin";
  }
  if (!matchesServingEndpoint(origin, input)) {
    return false;
  }
  // `same-site` is a different port on this host. That is the attack.
  return site === undefined || site === "same-origin";
}

function normalizeFetchSite(value: string | undefined): string | undefined {
  const site = value?.trim().toLowerCase();
  return site && site.length > 0 ? site : undefined;
}

function collectPrivilegedOrigins(input: CookieOriginRequest): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const origin of DESKTOP_RENDERER_ORIGINS) {
    const normalized = normalizeOrigin(origin);
    if (normalized) origins.add(normalized);
  }
  if (input.devUrl) {
    const normalized = normalizeOrigin(input.devUrl.origin);
    if (normalized) origins.add(normalized);
  }
  for (const origin of input.hostedAppOrigins) {
    const normalized = normalizeOrigin(origin);
    if (normalized) origins.add(normalized);
  }
  return origins;
}

function collectDevAllowedOrigins(input: CookieOriginRequest): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const origin of devAllowedCookieOrigins({
    origins: input.devAllowedOrigins,
    devUrl: input.devUrl,
  }).trusted) {
    const normalized = normalizeOrigin(origin);
    if (normalized) origins.add(normalized);
  }
  return origins;
}

function collectTailscaleServeOrigins(input: CookieOriginRequest): ReadonlySet<string> {
  const origins = new Set<string>();
  if (!input.tailscaleServeEnabled) {
    return origins;
  }
  const hosts = [
    ...input.magicDnsNames,
    ...input.interfaceAddresses.filter(
      (address) => isTailscaleIpv4Address(address) || isTailscaleIpv6(address),
    ),
  ];
  for (const host of hosts) {
    const normalized = normalizeHostname(host).replace(/\.$/u, "");
    if (normalized.length === 0) continue;
    try {
      const url = new URL(`https://${formatHostForUrl(normalized)}`);
      if (input.tailscaleServePort !== 443) {
        url.port = String(input.tailscaleServePort);
      }
      origins.add(url.origin);
    } catch {
      // Skip a MagicDNS name that is not a valid URL host.
    }
  }
  return origins;
}

function matchesServingEndpoint(origin: string, input: CookieOriginRequest): boolean {
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") {
    return false;
  }
  const observed = observeRequestHost(input);
  if (observed === undefined) {
    return false;
  }
  const originHttps = originUrl.protocol === "https:";
  if (originHttps !== observed.https) {
    return false;
  }
  const originPort = originUrl.port ? Number(originUrl.port) : originHttps ? 443 : 80;
  if (originUrl.hostname.toLowerCase() !== observed.hostname || originPort !== observed.port) {
    return false;
  }
  return isServedHostname(observed.hostname, input);
}

function observeRequestHost(
  input: CookieOriginRequest,
): { readonly hostname: string; readonly port: number; readonly https: boolean } | undefined {
  const forwardedHttps = isHttpsForwardedProto(input.forwardedProto);
  const hostHeader = input.hostHeader?.trim();
  if (hostHeader) {
    return parseAuthority(hostHeader, forwardedHttps ? "https" : "http");
  }
  const originalUrl = input.originalUrl?.trim();
  if (!originalUrl || originalUrl.startsWith("/")) {
    return undefined;
  }
  try {
    const url = new URL(originalUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    const https = forwardedHttps || url.protocol === "https:";
    return parseAuthority(url.host, https ? "https" : "http");
  } catch {
    return undefined;
  }
}

function parseAuthority(
  hostHeader: string,
  protocol: "http" | "https",
): { readonly hostname: string; readonly port: number; readonly https: boolean } | undefined {
  try {
    const url = new URL(`${protocol}://${hostHeader}`);
    const port = url.port ? Number(url.port) : protocol === "https" ? 443 : 80;
    if (!Number.isInteger(port)) {
      return undefined;
    }
    return {
      hostname: url.hostname.toLowerCase(),
      port,
      https: protocol === "https",
    };
  } catch {
    return undefined;
  }
}

function isHttpsForwardedProto(value: string | undefined): boolean {
  return value?.split(",")[0]?.trim().toLowerCase() === "https";
}

function isServedHostname(hostname: string, input: CookieOriginRequest): boolean {
  return servedHosts(input).has(hostname);
}

function servedHosts(input: CookieOriginRequest): ReadonlySet<string> {
  const hosts = new Set<string>(LOOPBACK_HOSTS);
  for (const address of input.interfaceAddresses) {
    const normalized = normalizeHostname(address);
    if (normalized.length > 0) hosts.add(normalized);
  }
  if (input.bindHost && !isWildcardHost(input.bindHost)) {
    const normalized = normalizeHostname(input.bindHost);
    if (normalized.length > 0) hosts.add(normalized);
  }
  for (const name of input.magicDnsNames) {
    const normalized = normalizeHostname(name).replace(/\.$/u, "");
    if (normalized.length > 0) hosts.add(normalized);
  }
  if (publishesLanNames(input.bindHost)) {
    const hostname = normalizeHostname(input.hostname);
    if (hostname.length > 0) {
      hosts.add(hostname);
      const short = hostname.split(".")[0];
      if (short && short.length > 0) {
        hosts.add(short);
        hosts.add(`${short}.local`);
      }
    }
  }
  return hosts;
}

function publishesLanNames(bindHost: string | undefined): boolean {
  if (bindHost === undefined || bindHost.trim().length === 0) {
    return false;
  }
  if (isWildcardHost(bindHost)) {
    return true;
  }
  return !LOOPBACK_HOSTS.has(normalizeHostname(bindHost));
}

function isWildcardHost(host: string): boolean {
  const normalized = normalizeHostname(host);
  return normalized === "0.0.0.0" || normalized === "::";
}

function normalizeHostname(value: string): string {
  let host = value.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  const zone = host.indexOf("%");
  if (zone !== -1) {
    host = host.slice(0, zone);
  }
  return host;
}

function isLoopbackOrigin(origin: string): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return false;
  }
  try {
    return LOOPBACK_HOSTS.has(new URL(normalized).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isTailscaleIpv6(address: string): boolean {
  return normalizeHostname(address).startsWith(TAILSCALE_IPV6_PREFIX);
}

function formatHostForUrl(hostname: string): string {
  return hostname.includes(":") ? `[${hostname}]` : hostname;
}
