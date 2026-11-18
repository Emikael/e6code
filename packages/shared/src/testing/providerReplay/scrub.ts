/**
 * Scrubs provider replay recordings before they are committed, and finds what
 * a scrub missed. The repository is open source, so a recording must carry no
 * secrets, home or temp paths, machine names, emails or the recorder's
 * identity. Recordings come from throwaway sample projects, so prose is kept.
 *
 * `findLeaks` is the gate: the scrub command refuses to write a file it flags,
 * and the corpus test runs it over every committed recording. Identities (the
 * recorder's login, name, hostname) are passed in at runtime and never
 * committed.
 *
 * @module testing/providerReplay/scrub
 */
import * as DateTime from "effect/DateTime";

import type {
  ProviderReplayRecording,
  RecordingEvent,
  RecordingHeader,
  RecordingLine,
} from "./recording.ts";

/** Bump when a rule changes so committed recordings are re-scrubbed. */
export const SCRUB_VERSION = 5;

const WORKSPACE_PLACEHOLDER = "/workspace/repo";
const HOME_PLACEHOLDER = "/home/user";
const TEMP_PLACEHOLDER = "/tmp/e6-replay";
const IDENTITY_PLACEHOLDER = "user";
const EMAIL_PLACEHOLDER = "user@example.com";
const HOST_PLACEHOLDER = "host.example";
const IP_PLACEHOLDER = "192.0.2.1";
export const SECRET_PLACEHOLDER = "[redacted]";
/** Recorded timestamps are rebased onto this instant, keeping their offsets. */
export const RECORDING_EPOCH_MS = Date.parse("2026-01-01T00:00:00.000Z");

export interface ScrubOptions {
  /** Absolute paths of the sample project (and its realpath); become `/workspace/repo`. */
  readonly workspaceRoots?: ReadonlyArray<string>;
  /** Absolute home directories; become `/home/user`. */
  readonly homeDirectories?: ReadonlyArray<string>;
  /** Login, real name, hostname and similar words; become `user`. */
  readonly identities?: ReadonlyArray<string>;
}

export interface RecordingLeak {
  readonly line: number;
  readonly kind:
    | "forbidden-field"
    | "credential-field"
    | "secret"
    | "home-path"
    | "temp-path"
    | "email"
    | "hostname"
    | "ip-address"
    | "identity"
    | "scrub-version"
    | "outside-workspace"
    | "local-environment";
  /** Dotted path to the offending value, never the value itself. */
  readonly path: string;
}

const FORBIDDEN_EVENT_FIELDS = ["raw", "providerRefs", "providerInstanceId"] as const;

const KEY_QUALIFIERS = new Set(["api", "access", "secret", "private", "signing", "session"]);
const CREDENTIAL_CONTAINER_KEYS = new Set([
  "auth",
  "credentials",
  "secrets",
  "cookies",
  "passwords",
]);
const CREDENTIAL_WORDS = new Set([
  "token",
  "secret",
  "secrets",
  "password",
  "passwords",
  "passwd",
  "credential",
  "credentials",
  "cookie",
  "cookies",
  "authorization",
  "apikey",
  "apikeys",
]);

/**
 * Whether an object key names a credential, in any casing or separator style:
 * `OPENAI_API_KEY`, `X-Auth-Token`, `sessionToken`, `set-cookie`. Plural
 * counters such as `inputTokens` are not credentials.
 */
function isCredentialKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
  if (isCredentialContainerKey(key)) return true;
  return words.some(
    (word, index) =>
      CREDENTIAL_WORDS.has(word) ||
      ((word === "key" || word === "keys") && index > 0 && KEY_QUALIFIERS.has(words[index - 1]!)),
  );
}

/**
 * Keys whose whole value is credentials, objects included (OpenCode's
 * auth.json `auth`, a `credentials` map). Other credential-named keys only
 * hold secrets as strings: `tokenUsage` is an object of counts and labels.
 */
function isCredentialContainerKey(key: string): boolean {
  return CREDENTIAL_CONTAINER_KEYS.has(key.toLowerCase());
}

/** Whether a credential-named field still holds a secret; counts and flags are kept. */
function holdsSecret(value: unknown, container: boolean): boolean {
  if (typeof value === "string") return value.length > 0 && value !== SECRET_PLACEHOLDER;
  if (Array.isArray(value)) return value.some((entry) => holdsSecret(entry, container));
  return (
    container &&
    typeof value === "object" &&
    value !== null &&
    Object.values(value).some((entry) => holdsSecret(entry, container))
  );
}

function redactSecret(value: unknown, container: boolean): unknown {
  if (typeof value === "string") return value.length > 0 ? SECRET_PLACEHOLDER : value;
  if (Array.isArray(value)) return value.map((entry) => redactSecret(entry, container));
  if (!container || typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, redactSecret(entry, container)]),
  );
}

// Each pattern matches a credential as a whole token; the scrubber replaces
// the match and the leak check flags it. Kept in one list so both agree.
const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9][A-Za-z0-9_-]{15,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bxai-[A-Za-z0-9]{20,}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bya29\.[0-9A-Za-z_-]{20,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g,
  /\bBasic\s+[A-Za-z0-9+/=]{12,}/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g,
  /\bx-api-key:\s*[^\s"']{8,}/gi,
  /https?:\/\/[^\s"'<>]*\/pair#[^\s"'<>]*/gi,
];

// Assignments keep the name and lose the value: `NAME_TOKEN=value` and
// `"API_KEY": "value"` for env-style names, `password=value` for plain ones.
// Plain names need `=`, since `token: string` is ordinary code.
const SECRET_ASSIGNMENTS: ReadonlyArray<RegExp> = [
  /\b([A-Z][A-Z0-9_]*(?:_KEY|_TOKEN|_SECRET|_PASSWORD|_PASSWD)["']?)(\s*[=:]\s*)(["']?)([^\s"'&]{6,})\3/g,
  /(?<![A-Za-z0-9])([a-z0-9_]*(?:password|passwd|secret|token|api_key|apikey))(=)(["']?)([^\s"'&]{6,})\3/gi,
];
// `"some_key": "value"` in JSON text, judged by the same rule as object keys.
const QUOTED_KEY_VALUE = /"([^"\n]{1,64})"(\s*:\s*)"([^"\n]{6,})"/g;
// `scheme://user:password@host` keeps the scheme and host.
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@"'<>]+:[^\s/@"'<>]+@/gi;
const SECRET_QUERY_PARAMETER =
  /([?&](?:token|access_token|api_key|apikey|key|sig|signature|auth)=)[^&#\s"'<>]+/gi;

const USERS_PATH = /(?:\/Users|\/home)\/(?!user\b)[^/\s"'`:;,)\]}]+/g;
const WINDOWS_USERS_PATH = /[A-Za-z]:[\\/]+Users[\\/]+(?!user\b)[^\\/\s"'`:;,)\]}]+/gi;
const TEMP_PATH =
  /(?:\/private)?\/var\/folders\/[^/\s"'`]+\/[^/\s"'`]+\/[A-Z](?=\/|\b)|[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s]+[\\/]+AppData[\\/]+Local[\\/]+Temp/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|net)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// mDNS and tailnet names. A following ".json" or similar means a file name
// such as settings.local.json, not a host.
const PRIVATE_HOSTNAME =
  /\b[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\.(?:local|ts\.net)\b(?!\.[A-Za-z0-9]|-)/gi;
// Four dotted numbers not inside a longer dotted run, so "1.2.3.4.5" is a
// version but "at 10.1.2.3." ending a sentence is an address.
const IPV4 = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?!\.?\d)/g;
// Tailscale's IPv6 range; other IPv6 forms are too close to code (`a::b`) to match safely.
const TAILNET_IPV6 = /\bfd7a:115c:a1e0(?::[0-9a-f]{0,4}){1,5}\b/gi;
const IPV6_PLACEHOLDER = "2001:db8::1";

function isAllowedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  const [a, b, c] = octets as [number, number, number, number];
  if (a === 127 || a === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function identityPattern(identity: string): RegExp {
  // Word-bounded where the identity starts or ends with a word character, so
  // "ana" never matches inside "banana".
  const leading = /^\w/.test(identity) ? "(?<![A-Za-z0-9])" : "";
  const trailing = /\w$/.test(identity) ? "(?![A-Za-z0-9])" : "";
  return new RegExp(`${leading}${escapeRegExp(identity)}${trailing}`, "gi");
}

function usableIdentities(identities: ReadonlyArray<string> | undefined): ReadonlyArray<string> {
  const unique = new Set<string>();
  for (const raw of identities ?? []) {
    const value = raw.trim();
    if (value.length >= 3 && value.toLowerCase() !== IDENTITY_PLACEHOLDER) unique.add(value);
  }
  // Longest first so a full name is replaced before its parts.
  return [...unique].sort((left, right) => right.length - left.length);
}

function usablePaths(paths: ReadonlyArray<string> | undefined): ReadonlyArray<string> {
  const unique = new Set<string>();
  for (const raw of paths ?? []) {
    const value = raw.trim().replace(/[\\/]+$/, "");
    if (value.length > 1) unique.add(value);
  }
  return [...unique].sort((left, right) => right.length - left.length);
}

function makeStringScrubber(options: ScrubOptions): (value: string) => string {
  const workspaceRoots = usablePaths(options.workspaceRoots);
  const homeDirectories = usablePaths(options.homeDirectories);
  const identities = usableIdentities(options.identities).map(identityPattern);
  return (input) => {
    let value = input;
    for (const root of workspaceRoots) value = value.split(root).join(WORKSPACE_PLACEHOLDER);
    for (const home of homeDirectories) value = value.split(home).join(HOME_PLACEHOLDER);
    for (const pattern of SECRET_PATTERNS) value = value.replace(pattern, SECRET_PLACEHOLDER);
    for (const pattern of SECRET_ASSIGNMENTS) {
      value = value.replace(
        pattern,
        (_match, name: string, separator: string, quote: string) =>
          `${name}${separator}${quote}${SECRET_PLACEHOLDER}${quote}`,
      );
    }
    value = value.replace(QUOTED_KEY_VALUE, (match, key: string, separator: string) =>
      isCredentialKey(key) ? `"${key}"${separator}"${SECRET_PLACEHOLDER}"` : match,
    );
    value = value.replace(URL_CREDENTIALS, `$1${SECRET_PLACEHOLDER}@`);
    value = value.replace(SECRET_QUERY_PARAMETER, `$1${SECRET_PLACEHOLDER}`);
    value = value.replace(TEMP_PATH, TEMP_PLACEHOLDER);
    value = value.replace(USERS_PATH, HOME_PLACEHOLDER);
    value = value.replace(WINDOWS_USERS_PATH, HOME_PLACEHOLDER);
    value = value.replace(EMAIL, EMAIL_PLACEHOLDER);
    value = value.replace(PRIVATE_HOSTNAME, HOST_PLACEHOLDER);
    value = value.replace(IPV4, (address) => (isAllowedIpv4(address) ? address : IP_PLACEHOLDER));
    value = value.replace(TAILNET_IPV6, IPV6_PLACEHOLDER);
    for (const pattern of identities) value = value.replace(pattern, IDENTITY_PLACEHOLDER);
    return value;
  };
}

function scrubValue(value: unknown, scrubString: (value: string) => string): unknown {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((entry) => scrubValue(entry, scrubString));
  if (typeof value !== "object" || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    // Keys are scrubbed too: tool payloads often key changes by absolute path.
    result[scrubString(key)] = isCredentialKey(key)
      ? redactSecret(scrubValue(entry, scrubString), isCredentialContainerKey(key))
      : scrubValue(entry, scrubString);
  }
  return result;
}

function withoutForbiddenFields(event: RecordingEvent["event"]): RecordingEvent["event"] {
  const copy: Record<string, unknown> = { ...event };
  for (const field of FORBIDDEN_EVENT_FIELDS) delete copy[field];
  return copy as RecordingEvent["event"];
}

type ReplayEvent = RecordingEvent["event"];

const OUTSIDE_WORKSPACE_DATA = { omitted: "outside-workspace" } as const;
const OMITTED = "[omitted]";
const ITEM_EVENT_TYPES = new Set(["item.started", "item.updated", "item.completed"]);
const OUTPUT_STREAM_KINDS = new Set(["command_output", "file_change_output"]);
const MAX_HOME_DETAIL_CHARACTERS = 200;
// After path scrubbing the home folder reads `/home/user/`; commands also say `~/` or `$HOME`.
const HOME_REFERENCE = /\/home\/user\/|(?<![\w/.~])~\/|\$HOME\b/;
const HOME_PATH = /\/home\/user\/[^\s"'`<>]*/;

const payloadOf = (event: ReplayEvent) => event.payload as Record<string, unknown>;

/**
 * Streamed text arrives in chunks as small as one character, so a name or a
 * path can be split across events. Chunks are scrubbed and checked as the
 * stream they belong to: one per turn, item and stream kind.
 */
function streamKey(event: ReplayEvent): string | undefined {
  if (event.type === "content.delta") {
    return `${event.turnId ?? ""}|${event.itemId ?? ""}|${event.payload.streamKind}`;
  }
  if (event.type === "turn.proposed.delta") return `${event.turnId ?? ""}|proposed`;
  return undefined;
}

/** Line indexes of each text stream's chunks, in recording order. */
function textStreams(lines: ReadonlyArray<RecordingLine>): ReadonlyMap<string, Array<number>> {
  const streams = new Map<string, Array<number>>();
  lines.forEach((line, index) => {
    if (line.kind !== "event") return;
    const key = streamKey(line.event);
    if (key === undefined) return;
    const indexes = streams.get(key) ?? [];
    indexes.push(index);
    streams.set(key, indexes);
  });
  return streams;
}

const deltaAt = (lines: ReadonlyArray<RecordingLine>, index: number): string => {
  const line = lines[index];
  return line?.kind === "event" ? String(payloadOf(line.event).delta ?? "") : "";
};

function withDelta(line: RecordingLine, delta: string): RecordingLine {
  if (line.kind !== "event") return line;
  return {
    ...line,
    event: { ...line.event, payload: { ...payloadOf(line.event), delta } } as ReplayEvent,
  };
}

/**
 * Splits scrubbed text back into as many chunks as the original stream had,
 * at proportional offsets, so event counts and the joined text both hold.
 * Unchanged text keeps its original chunks.
 */
function resplit(chunks: ReadonlyArray<string>, text: string): ReadonlyArray<string> {
  const joined = chunks.join("");
  if (text === joined) return chunks;
  const result: Array<string> = [];
  let consumed = 0;
  let previousCut = 0;
  chunks.forEach((chunk, index) => {
    consumed += chunk.length;
    const cut =
      index === chunks.length - 1
        ? text.length
        : Math.round((consumed / Math.max(joined.length, 1)) * text.length);
    result.push(text.slice(previousCut, cut));
    previousCut = cut;
  });
  return result;
}

/**
 * Items that touched the home folder, such as an agent reading the
 * recorder's global skills or config, carry that file's text. They keep
 * their title, status and a short path; their data and output are dropped.
 */
function homeItemIds(lines: ReadonlyArray<RecordingLine>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const line of lines) {
    if (line.kind !== "event" || !ITEM_EVENT_TYPES.has(line.event.type)) continue;
    if (line.event.itemId === undefined) continue;
    if (HOME_REFERENCE.test(JSON.stringify(line.event.payload))) ids.add(line.event.itemId);
  }
  return ids;
}

const isHomeOutputStream = (event: ReplayEvent, homeItems: ReadonlySet<string>) =>
  event.type === "content.delta" &&
  event.itemId !== undefined &&
  homeItems.has(event.itemId) &&
  OUTPUT_STREAM_KINDS.has(event.payload.streamKind);

/** Whether an item event belongs to an item that touched the home folder. */
function isHomeItemEvent(event: ReplayEvent, homeItems: ReadonlySet<string>): boolean {
  if (!ITEM_EVENT_TYPES.has(event.type)) return false;
  return event.itemId === undefined
    ? HOME_REFERENCE.test(JSON.stringify(event.payload))
    : homeItems.has(event.itemId);
}

/** A home item's detail becomes the home path it names; a write's content goes with it. */
function shortHomeDetail(detail: string): string {
  const path = HOME_PATH.exec(detail)?.[0];
  if (path !== undefined) return path;
  return detail.length <= MAX_HOME_DETAIL_CHARACTERS ? detail : OMITTED;
}

function withoutHomeItemContent(event: ReplayEvent, homeItems: ReadonlySet<string>): ReplayEvent {
  if (!isHomeItemEvent(event, homeItems)) return event;
  const payload = { ...payloadOf(event) };
  if (payload.data !== undefined) payload.data = OUTSIDE_WORKSPACE_DATA;
  if (typeof payload.detail === "string") payload.detail = shortHomeDetail(payload.detail);
  return { ...event, payload } as ReplayEvent;
}

/** What a home item still holds that a scrubbed recording would not. */
function homeItemLeaks(event: ReplayEvent, homeItems: ReadonlySet<string>): ReadonlyArray<string> {
  if (!isHomeItemEvent(event, homeItems)) return [];
  const payload = payloadOf(event);
  const fields: Array<string> = [];
  if (
    payload.data !== undefined &&
    JSON.stringify(payload.data) !== JSON.stringify(OUTSIDE_WORKSPACE_DATA)
  ) {
    fields.push("data");
  }
  if (typeof payload.detail === "string" && shortHomeDetail(payload.detail) !== payload.detail) {
    fields.push("detail");
  }
  return fields;
}

/**
 * Claude's init message lists every tool, MCP server, plugin, skill and agent
 * the recorder has installed, plus local paths; hooks print whatever the
 * recorder's own hooks print. Nothing downstream reads either, so recordings
 * keep only what describes the session itself.
 */
const SESSION_CONFIG_KEYS = new Set([
  "type",
  "subtype",
  "model",
  "cwd",
  "effort",
  "permissionMode",
  "claude_code_version",
  "output_style",
]);
const HOOK_EVENT_TYPES = new Set(["hook.progress", "hook.completed"]);
const HOOK_OUTPUT_FIELDS = ["output", "stdout", "stderr"] as const;
const OMITTED_OUTPUT = OMITTED;

function localEnvironmentFields(event: RecordingEvent["event"]): ReadonlyArray<string> {
  const payload = event.payload as Record<string, unknown>;
  if (event.type === "session.configured") {
    const config = payload.config;
    if (typeof config !== "object" || config === null) return [];
    return Object.keys(config)
      .filter((key) => !SESSION_CONFIG_KEYS.has(key))
      .map((key) => `config.${key}`);
  }
  if (HOOK_EVENT_TYPES.has(event.type)) {
    return HOOK_OUTPUT_FIELDS.filter(
      (field) => typeof payload[field] === "string" && payload[field] !== OMITTED_OUTPUT,
    );
  }
  return [];
}

function withoutLocalEnvironment(event: RecordingEvent["event"]): RecordingEvent["event"] {
  if (localEnvironmentFields(event).length === 0) return event;
  const payload = { ...(event.payload as Record<string, unknown>) };
  if (event.type === "session.configured") {
    payload.config = Object.fromEntries(
      Object.entries(payload.config as Record<string, unknown>).filter(([key]) =>
        SESSION_CONFIG_KEYS.has(key),
      ),
    );
  } else {
    for (const field of HOOK_OUTPUT_FIELDS) {
      if (typeof payload[field] === "string") payload[field] = OMITTED_OUTPUT;
    }
  }
  return { ...event, payload } as RecordingEvent["event"];
}

function rebaseCreatedAt(createdAt: string, firstEventAtMs: number | undefined): string {
  const at = Date.parse(createdAt);
  const offset =
    Number.isFinite(at) && firstEventAtMs !== undefined ? Math.max(0, at - firstEventAtMs) : 0;
  return DateTime.formatIso(DateTime.makeUnsafe(RECORDING_EPOCH_MS + offset));
}

/**
 * Returns a scrubbed copy: forbidden event fields removed, timestamps rebased
 * onto a fixed epoch, and every string run through the path, identity and
 * secret rules. Scrubbing a scrubbed recording changes nothing.
 */
export function scrubRecording(
  recording: ProviderReplayRecording,
  options: ScrubOptions = {},
): ProviderReplayRecording {
  const scrubString = makeStringScrubber(options);
  let firstEventAtMs: number | undefined;
  for (const line of recording.lines) {
    if (line.kind !== "event") continue;
    const at = Date.parse(line.event.createdAt);
    if (Number.isFinite(at)) {
      firstEventAtMs = at;
      break;
    }
  }
  const header = scrubValue(
    { ...recording.header, scrubVersion: SCRUB_VERSION },
    scrubString,
  ) as RecordingHeader;
  const lines = recording.lines.map((line): RecordingLine => {
    if (line.kind !== "event") return scrubValue(line, scrubString) as RecordingLine;
    const event = withoutForbiddenFields(line.event);
    const scrubbed = withoutLocalEnvironment(scrubValue(event, scrubString) as ReplayEvent);
    return {
      kind: "event",
      dt: line.dt,
      event: { ...scrubbed, createdAt: rebaseCreatedAt(line.event.createdAt, firstEventAtMs) },
    };
  });
  // Streamed text is scrubbed joined, so nothing split across chunks survives.
  for (const indexes of textStreams(recording.lines).values()) {
    const chunks = indexes.map((index) => deltaAt(recording.lines, index));
    const scrubbedChunks = resplit(chunks, scrubString(chunks.join("")));
    indexes.forEach((index, position) => {
      lines[index] = withDelta(lines[index]!, scrubbedChunks[position] ?? "");
    });
  }
  const homeItems = homeItemIds(lines);
  for (const indexes of textStreams(lines).values()) {
    const first = lines[indexes[0]!];
    if (first?.kind !== "event" || !isHomeOutputStream(first.event, homeItems)) continue;
    indexes.forEach((index, position) => {
      lines[index] = withDelta(lines[index]!, position === 0 ? OMITTED : "");
    });
  }
  return {
    header,
    lines: lines.map((line) =>
      line.kind === "event"
        ? { ...line, event: withoutHomeItemContent(line.event, homeItems) }
        : line,
    ),
  };
}

function collectStringLeaks(
  value: string,
  path: string,
  line: number,
  identities: ReadonlyArray<RegExp>,
  leaks: Array<RecordingLeak>,
): void {
  const report = (kind: RecordingLeak["kind"]) => leaks.push({ line, kind, path });
  if (SECRET_PATTERNS.some((pattern) => new RegExp(pattern.source, pattern.flags).test(value))) {
    report("secret");
  }
  for (const pattern of SECRET_ASSIGNMENTS) {
    for (const match of value.matchAll(new RegExp(pattern.source, pattern.flags))) {
      if (match[4] !== SECRET_PLACEHOLDER) report("secret");
    }
  }
  for (const match of value.matchAll(new RegExp(QUOTED_KEY_VALUE.source, "g"))) {
    if (isCredentialKey(match[1]!) && match[3] !== SECRET_PLACEHOLDER) report("secret");
  }
  for (const match of value.matchAll(new RegExp(URL_CREDENTIALS.source, "gi"))) {
    if (!match[0].includes(SECRET_PLACEHOLDER)) report("secret");
  }
  if (new RegExp(TEMP_PATH.source, "g").test(value)) report("temp-path");
  if (
    new RegExp(USERS_PATH.source, "g").test(value) ||
    new RegExp(WINDOWS_USERS_PATH.source, "gi").test(value)
  ) {
    report("home-path");
  }
  if (new RegExp(EMAIL.source, "g").test(value)) report("email");
  if (new RegExp(PRIVATE_HOSTNAME.source, "gi").test(value)) report("hostname");
  for (const match of value.matchAll(new RegExp(IPV4.source, "g"))) {
    if (!isAllowedIpv4(match[0])) report("ip-address");
  }
  if (new RegExp(TAILNET_IPV6.source, "gi").test(value)) report("ip-address");
  if (identities.some((pattern) => new RegExp(pattern.source, pattern.flags).test(value))) {
    report("identity");
  }
}

function collectLeaks(
  value: unknown,
  path: string,
  line: number,
  identities: ReadonlyArray<RegExp>,
  leaks: Array<RecordingLeak>,
): void {
  if (typeof value === "string") {
    collectStringLeaks(value, path, line, identities, leaks);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectLeaks(entry, `${path}[${index}]`, line, identities, leaks),
    );
    return;
  }
  if (typeof value !== "object" || value === null) return;
  let keyIndex = 0;
  for (const [key, entry] of Object.entries(value)) {
    // A key that leaks is named by position so reports never echo it.
    const before = leaks.length;
    const keyPath = `${path.length > 0 ? path : "<root>"}{key ${keyIndex}}`;
    keyIndex += 1;
    collectStringLeaks(key, keyPath, line, identities, leaks);
    const childPath = leaks.length > before ? keyPath : path.length > 0 ? `${path}.${key}` : key;
    if (isCredentialKey(key) && holdsSecret(entry, isCredentialContainerKey(key))) {
      leaks.push({ line, kind: "credential-field", path: childPath });
    }
    collectLeaks(entry, childPath, line, identities, leaks);
  }
}

/**
 * Finds anything a committed recording must not contain. Line numbers are
 * 1-based NDJSON lines (the header is line 1). Leak paths name where the
 * value is, never the value, so reports are safe to print.
 */
export function findLeaks(
  recording: ProviderReplayRecording,
  options: { readonly identities?: ReadonlyArray<string> } = {},
): ReadonlyArray<RecordingLeak> {
  const identities = usableIdentities(options.identities).map(identityPattern);
  const leaks: Array<RecordingLeak> = [];
  if (recording.header.scrubVersion !== SCRUB_VERSION) {
    leaks.push({ line: 1, kind: "scrub-version", path: "scrubVersion" });
  }
  collectLeaks(recording.header, "", 1, identities, leaks);
  const homeItems = homeItemIds(recording.lines);
  recording.lines.forEach((line, index) => {
    const lineNumber = index + 2;
    if (line.kind === "event") {
      for (const field of FORBIDDEN_EVENT_FIELDS) {
        if (Object.hasOwn(line.event, field)) {
          leaks.push({ line: lineNumber, kind: "forbidden-field", path: `event.${field}` });
        }
      }
      for (const field of homeItemLeaks(line.event, homeItems)) {
        leaks.push({ line: lineNumber, kind: "outside-workspace", path: `event.payload.${field}` });
      }
      for (const field of localEnvironmentFields(line.event)) {
        leaks.push({ line: lineNumber, kind: "local-environment", path: `event.payload.${field}` });
      }
    }
    collectLeaks(line, "", lineNumber, identities, leaks);
  });
  for (const indexes of textStreams(recording.lines).values()) {
    const first = recording.lines[indexes[0]!];
    if (first?.kind !== "event") continue;
    const lineNumber = indexes[0]! + 2;
    const text = indexes.map((index) => deltaAt(recording.lines, index)).join("");
    const path = `stream:${String(payloadOf(first.event).streamKind ?? "proposed")}`;
    // Report what only the joined text shows; a leak inside one chunk is already listed.
    const chunkLines = new Set(indexes.map((index) => index + 2));
    const chunkKinds = new Set(
      leaks.filter((leak) => chunkLines.has(leak.line)).map((leak) => leak.kind),
    );
    const joined: Array<RecordingLeak> = [];
    collectStringLeaks(text, path, lineNumber, identities, joined);
    leaks.push(...joined.filter((leak) => !chunkKinds.has(leak.kind)));
    if (isHomeOutputStream(first.event, homeItems) && text !== OMITTED) {
      leaks.push({ line: lineNumber, kind: "outside-workspace", path });
    }
  }
  return leaks;
}
