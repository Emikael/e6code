import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { make } from "./updateCheck.ts";

const encodeJsonString = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const RELEASES = [
  { tag_name: "v1.4.0", draft: true },
  { tag_name: "v1.3.0-nightly.20261030.1" },
  { tag_name: "v1.3.0-preview.20261029.1" },
  { tag_name: "v1.2.0" },
  { tag_name: "v1.2.0-nightly.20261001.1" },
];

/**
 * A release index that answers every page with `releases` and counts requests.
 * With `gate`, each response waits for it to complete.
 */
function releaseIndex(
  releases: ReadonlyArray<unknown> = RELEASES,
  status = 200,
  gate?: Deferred.Deferred<void>,
) {
  const counter = { requests: 0 };
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      counter.requests += 1;
    }).pipe(
      Effect.andThen(gate === undefined ? Effect.void : Deferred.await(gate)),
      Effect.as(
        HttpClientResponse.fromWeb(request, new Response(encodeJsonString(releases), { status })),
      ),
    ),
  );
  return { counter, client };
}

const noNetwork = HttpClient.make(() => Effect.die("update check should not make a request"));

const check = (currentVersion: string, client: HttpClient.HttpClient) =>
  make(currentVersion).pipe(Effect.provideService(HttpClient.HttpClient, client));

it.effect("offers the newest stable release to a stable server, skipping newer nightlies", () =>
  Effect.gen(function* () {
    const { client } = releaseIndex();
    const service = yield* check("1.1.0", client);
    assert.deepStrictEqual(yield* service.check({}), {
      currentVersion: "1.1.0",
      latestVersion: "1.2.0",
      updateAvailable: true,
      checkedAt: "1970-01-01T00:00:00.000Z",
    });
  }),
);

it.effect("offers the newest nightly to a nightly server", () =>
  Effect.gen(function* () {
    const { client } = releaseIndex();
    const service = yield* check("1.2.0-nightly.20261001.1", client);
    const result = yield* service.check({});
    assert.equal(result.latestVersion, "1.3.0-nightly.20261030.1");
    assert.isTrue(result.updateAvailable);
  }),
);

it.effect("reports no update when the server already runs the newest release", () =>
  Effect.gen(function* () {
    const { client } = releaseIndex();
    const service = yield* check("1.2.0", client);
    const result = yield* service.check({});
    assert.equal(result.latestVersion, "1.2.0");
    assert.isFalse(result.updateAvailable);
  }),
);

it.effect("never looks up releases for a preview build", () =>
  Effect.gen(function* () {
    const service = yield* check("1.3.0-preview.20261029.1", noNetwork);
    assert.deepStrictEqual(yield* service.check({ force: true }), {
      currentVersion: "1.3.0-preview.20261029.1",
      latestVersion: null,
      updateAvailable: false,
      checkedAt: null,
    });
  }),
);

it.effect("answers from cache, and lets force refetch at most once a minute", () =>
  Effect.gen(function* () {
    const { client, counter } = releaseIndex();
    const service = yield* check("1.1.0", client);
    yield* service.check({});
    yield* service.check({});
    yield* service.check({ force: true });
    assert.equal(counter.requests, 1);

    yield* TestClock.adjust("61 seconds");
    yield* service.check({});
    assert.equal(counter.requests, 1);
    const forced = yield* service.check({ force: true });
    assert.equal(counter.requests, 2);
    assert.equal(forced.checkedAt, "1970-01-01T00:01:01.000Z");

    yield* TestClock.adjust("1 hour");
    yield* service.check({});
    assert.equal(counter.requests, 3);
  }),
);

it.effect("shares one lookup between concurrent checks", () =>
  Effect.gen(function* () {
    const gate = yield* Deferred.make<void>();
    const { client, counter } = releaseIndex(RELEASES, 200, gate);
    const service = yield* check("1.1.0", client);
    const first = yield* Effect.forkChild(service.check({ force: true }), {
      startImmediately: true,
    });
    const second = yield* Effect.forkChild(service.check({ force: true }), {
      startImmediately: true,
    });
    assert.equal(counter.requests, 1);
    yield* Deferred.succeed(gate, undefined);
    const results = yield* Fiber.joinAll([first, second]);
    assert.deepStrictEqual(
      results.map((result) => result.latestVersion),
      ["1.2.0", "1.2.0"],
    );
    assert.equal(counter.requests, 1);
  }),
);

it.effect("does not count an interrupted lookup against the rate limit", () =>
  Effect.gen(function* () {
    const gate = yield* Deferred.make<void>();
    const { client, counter } = releaseIndex(RELEASES, 200, gate);
    const service = yield* check("1.1.0", client);
    const interrupted = yield* Effect.forkChild(service.check({}), { startImmediately: true });
    yield* Fiber.interrupt(interrupted);
    yield* Deferred.succeed(gate, undefined);
    assert.equal((yield* service.check({})).latestVersion, "1.2.0");
    assert.equal(counter.requests, 2);
  }),
);

it.effect("rate-limits lookups after a failure", () =>
  Effect.gen(function* () {
    const { client, counter } = releaseIndex([], 500);
    const service = yield* check("1.1.0", client);
    yield* service.check({});
    yield* service.check({ force: true });
    assert.equal(counter.requests, 1);
    yield* TestClock.adjust("61 seconds");
    yield* service.check({});
    assert.equal(counter.requests, 2);
  }),
);

it.effect("reports no latest version when the track has no release yet", () =>
  Effect.gen(function* () {
    const { client, counter } = releaseIndex([{ tag_name: "v1.3.0-nightly.20261030.1" }]);
    const service = yield* check("1.1.0", client);
    const result = yield* service.check({});
    assert.isNull(result.latestVersion);
    assert.isNull(result.checkedAt);
    assert.isFalse(result.updateAvailable);
    const requests = counter.requests;
    yield* service.check({ force: true });
    assert.equal(counter.requests, requests);
  }),
);

it.effect("reports no latest version when the release index fails", () =>
  Effect.gen(function* () {
    const { client } = releaseIndex([], 500);
    const service = yield* check("1.1.0", client);
    assert.deepStrictEqual(yield* service.check({}), {
      currentVersion: "1.1.0",
      latestVersion: null,
      updateAvailable: false,
      checkedAt: null,
    });
  }),
);

it.effect("gives up on a slow release index and keeps the last good answer", () =>
  Effect.gen(function* () {
    let hang = false;
    const { client: index } = releaseIndex();
    const client = HttpClient.make((request) => (hang ? Effect.never : index.execute(request)));
    const service = yield* check("1.1.0", client);
    const first = yield* service.check({});

    hang = true;
    yield* TestClock.adjust("2 hours");
    const pending = yield* Effect.forkChild(service.check({ force: true }));
    yield* TestClock.adjust("5 seconds");
    assert.deepStrictEqual(yield* Fiber.join(pending), first);
  }),
);
