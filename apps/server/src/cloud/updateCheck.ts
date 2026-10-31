import type { ServerCheckForUpdateInput, ServerUpdateCheckResult } from "@e6tools/contracts";
import { cliReleaseChannelOf } from "@e6tools/shared/cliRelease";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import { HttpClient } from "effect/unstable/http";

import packageJson from "../../package.json" with { type: "json" };
import { resolveNewestReleaseVersion } from "./releaseIndex.ts";
import { compareExactServiceVersions } from "./serviceProtocol.ts";

const CACHE_TTL_MS = Duration.toMillis(Duration.hours(1));
// Unauthenticated GitHub allows 60 requests per hour per IP, so repeated
// forced checks inside this window answer from the last lookup.
const MIN_ATTEMPT_INTERVAL_MS = Duration.toMillis(Duration.seconds(60));
const LOOKUP_TIMEOUT = Duration.seconds(5);
const LOOKUP_MAX_PAGES = 2;

/**
 * Answers `server.checkForUpdate`: the newest GitHub release on this server's
 * own track (stable or nightly). Lookups only happen on request, never at
 * startup. Failures are reported as `latestVersion: null`, never as errors.
 */
export class ServerUpdateCheck extends Context.Service<
  ServerUpdateCheck,
  {
    readonly check: (input: ServerCheckForUpdateInput) => Effect.Effect<ServerUpdateCheckResult>;
  }
>()("e6/cloud/updateCheck/ServerUpdateCheck") {}

export const make = Effect.fn("cloud.update_check.make")(function* (currentVersion: string) {
  const httpClient = yield* HttpClient.HttpClient;
  const channel = cliReleaseChannelOf(currentVersion);
  // One lookup at a time; callers queued behind it see its result as fresh.
  const lock = yield* Semaphore.make(1);
  let latestVersion: string | null = null;
  let checkedAtMs: number | null = null;
  let lastAttemptMs: number | null = null;

  const result = (): ServerUpdateCheckResult => ({
    currentVersion,
    latestVersion,
    updateAvailable:
      latestVersion !== null && compareExactServiceVersions(latestVersion, currentVersion) > 0,
    checkedAt: checkedAtMs === null ? null : DateTime.formatIso(DateTime.makeUnsafe(checkedAtMs)),
  });

  const lookup = Effect.fn("cloud.update_check.lookup")(function* (force: boolean) {
    const now = yield* Clock.currentTimeMillis;
    const fresh = checkedAtMs !== null && now - checkedAtMs < CACHE_TTL_MS;
    const recentlyAttempted =
      lastAttemptMs !== null && now - lastAttemptMs < MIN_ATTEMPT_INTERVAL_MS;
    if (recentlyAttempted || (fresh && !force)) return result();
    const found = yield* resolveNewestReleaseVersion(channel, { maxPages: LOOKUP_MAX_PAGES }).pipe(
      // One budget for the whole lookup, however many pages it walks.
      Effect.timeoutOption(LOOKUP_TIMEOUT),
      Effect.map(Option.flatMap(Option.fromUndefinedOr)),
      Effect.catch((error) =>
        Effect.logWarning("server update check failed", { reason: error.message }).pipe(
          Effect.as(Option.none<string>()),
        ),
      ),
      Effect.provideService(HttpClient.HttpClient, httpClient),
    );
    // Recorded only once the lookup finishes, so an interrupted one does not
    // count against the rate limit; failures do.
    lastAttemptMs = yield* Clock.currentTimeMillis;
    if (Option.isSome(found)) {
      latestVersion = found.value;
      checkedAtMs = lastAttemptMs;
    }
    return result();
  });

  return ServerUpdateCheck.of({
    check: (input) =>
      // Preview builds are never offered anything, so skip the network.
      channel === "preview"
        ? Effect.succeed({
            currentVersion,
            latestVersion: null,
            updateAvailable: false,
            checkedAt: null,
          })
        : lock.withPermit(lookup(input.force === true)),
  });
});

export const layer = Layer.effect(ServerUpdateCheck, make(packageJson.version));
