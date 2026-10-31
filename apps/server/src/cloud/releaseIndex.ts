import {
  cliReleaseIndexPageUrl,
  newestCliReleaseVersion,
  type CliReleaseChannel,
} from "@e6tools/shared/cliRelease";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

export class ReleaseIndexError extends Schema.TaggedError<ReleaseIndexError>()(
  "ReleaseIndexError",
  { message: Schema.String },
) {}

const ReleaseIndex = Schema.Array(
  Schema.Struct({
    tag_name: Schema.String,
    draft: Schema.optional(Schema.Boolean),
  }),
);
const decodeReleaseIndex = Schema.decodeUnknownEffect(Schema.fromJsonString(ReleaseIndex));

/**
 * Walks GitHub's release index, newest first, for the newest published version
 * on a channel. GitHub releases are the source because self-update downloads
 * their archives; npm publishes before the release exists. Returns undefined
 * when `maxPages` pages hold no match.
 */
export const resolveNewestReleaseVersion = Effect.fn("cloud.release_index.resolve_newest")(
  function* (
    channel: CliReleaseChannel,
    options: { readonly maxPages: number; readonly pageTimeout: Duration.Input },
  ) {
    const httpClient = yield* HttpClient.HttpClient;
    for (let page = 1; page <= options.maxPages; page += 1) {
      const body = yield* httpClient
        .execute(
          HttpClientRequest.get(cliReleaseIndexPageUrl(page)).pipe(
            HttpClientRequest.setHeader("Accept", "application/vnd.github+json"),
          ),
        )
        .pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap((response) => response.text),
          Effect.mapError(() => new ReleaseIndexError({ message: "Could not list e6 releases." })),
          Effect.timeoutOrElse({
            duration: options.pageTimeout,
            orElse: () =>
              Effect.fail(new ReleaseIndexError({ message: "Timed out listing e6 releases." })),
          }),
        );
      const releases = yield* decodeReleaseIndex(body).pipe(
        Effect.mapError(
          () => new ReleaseIndexError({ message: "The e6 release index had an unexpected shape." }),
        ),
      );
      const version = newestCliReleaseVersion(releases, channel);
      if (version !== undefined) return version;
      if (releases.length === 0) break;
    }
    return undefined;
  },
);
