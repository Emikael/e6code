import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Headers from "effect/unstable/http/Headers";

export const httpHeaderRedactionLayer = Layer.effect(
  Headers.CurrentRedactedNames,
  Effect.map(Headers.CurrentRedactedNames, (names) => [...names, "dpop"]),
);

const SENSITIVE_QUERY_NAME =
  /^(?:ticket|wsticket|token|secret|password|api[-_]?key|authorization|credential|access_token|refresh_token|id_token|code)$/i;

/**
 * Replaces sensitive query-parameter values with `[redacted]`.
 * The URL fragment is left intact: pairing tokens travel in the hash, not the query.
 */
export function redactSensitiveUrl(value: string): string {
  const queryIndex = value.indexOf("?");
  if (queryIndex === -1) {
    return value;
  }
  const hashIndex = value.indexOf("#", queryIndex);
  const query =
    hashIndex === -1 ? value.slice(queryIndex + 1) : value.slice(queryIndex + 1, hashIndex);
  const hash = hashIndex === -1 ? "" : value.slice(hashIndex);
  const redacted = query
    .split("&")
    .map((part) => {
      if (part.length === 0) {
        return part;
      }
      const separator = part.indexOf("=");
      const rawName = separator === -1 ? part : part.slice(0, separator);
      let name = rawName;
      try {
        name = decodeURIComponent(rawName.replaceAll("+", " "));
      } catch {
        name = rawName;
      }
      if (!SENSITIVE_QUERY_NAME.test(name)) {
        return part;
      }
      return `${rawName}=[redacted]`;
    })
    .join("&");
  return `${value.slice(0, queryIndex)}?${redacted}${hash}`;
}

export function redactSensitiveTraceValue(value: unknown): unknown {
  return typeof value === "string" ? redactSensitiveUrl(value) : value;
}
