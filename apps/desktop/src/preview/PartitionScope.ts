import {
  AGENT_BROWSER_PROFILE_ID,
  DEFAULT_BROWSER_PROFILE_ID,
  INCOGNITO_BROWSER_PROFILE_ID,
} from "@e6tools/contracts";

/**
 * Partition scope for an (environment, profile) pair.
 *
 * The default profile keeps the bare environment id it used before profiles
 * existed, so upgrading does not strand anyone's existing logins in an
 * orphaned partition. Incognito derives a non-persistent partition. The agent
 * profile is a separate persistent namespace that cookie import never writes.
 */
export function resolvePartitionScope(
  environmentId: string,
  profileId: string | undefined,
): {
  readonly scope: string;
  readonly persistent: boolean;
  readonly namespace?: "profile" | "agent";
} {
  if (profileId === AGENT_BROWSER_PROFILE_ID) {
    // Prefixed so the digest cannot collide with a default-profile scope even
    // if the namespace marker were dropped. The marker still keeps it disjoint.
    return { scope: `agent:${environmentId}`, persistent: true, namespace: "agent" };
  }
  if (profileId === undefined || profileId === DEFAULT_BROWSER_PROFILE_ID) {
    return { scope: environmentId, persistent: true };
  }
  // JSON's tuple framing is injective for strings, including lone UTF-16
  // surrogates (which it escapes). URI encoding throws on those supported ids,
  // while replacing them with U+FFFD would collapse distinct identities.
  return {
    scope: JSON.stringify([environmentId, profileId]),
    persistent: profileId !== INCOGNITO_BROWSER_PROFILE_ID,
    namespace: "profile" as const,
  };
}
