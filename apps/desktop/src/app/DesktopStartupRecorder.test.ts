import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import { REQUIRED_STARTUP_PHASES, StartupClock } from "./DesktopStartupClock.ts";
import type { StartupMemoryProcesses } from "./DesktopStartupRecord.ts";
import { makeStartupRecorder } from "./DesktopStartupRecorder.ts";

const decodeLine = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      type: Schema.String,
      outcome: Schema.optionalKey(Schema.String),
      label: Schema.optionalKey(Schema.String),
      phases: Schema.optionalKey(
        Schema.Record(Schema.String, Schema.Struct({ status: Schema.String })),
      ),
    }),
  ),
);

const bucket = { count: 1, workingSetBytes: 1024, peakWorkingSetBytes: 2048, pids: [1] };
const memory: StartupMemoryProcesses = {
  main: bucket,
  rendererMain: bucket,
  rendererOther: bucket,
  gpu: bucket,
  utility: bucket,
  other: bucket,
  serverChild: { status: "unavailable", reason: "not-running" },
};

const setup = Effect.gen(function* () {
  // The phase clock stays at its zero; the recorder's waits run on the TestClock.
  const clock = new StartupClock({
    processCreatedEpochMs: 1_000,
    nodeTimeOriginEpochMs: 1_000,
    now: () => 0,
  });
  const lines = yield* Ref.make<ReadonlyArray<ReturnType<typeof decodeLine>>>([]);
  const recorder = yield* makeStartupRecorder({
    clock,
    runId: "run",
    pid: 42,
    describe: Effect.succeed({
      app: {
        version: "0.0.46",
        platform: "darwin",
        arch: "arm64",
        isPackaged: true,
        isDevelopment: false,
      },
      launch: {
        localEnvironmentEnabled: true,
        wslOnly: false,
        wslBackendEnabled: false,
        environmentIdKnown: true,
      },
    }),
    sampleMemory: Effect.succeed(memory),
    writeLine: (line) => Ref.update(lines, (current) => [...current, decodeLine(line)]),
  });
  const records = Ref.get(lines).pipe(
    Effect.map((current) => current.filter((line) => line.type === "desktop-startup")),
  );
  const memoryLabels = Ref.get(lines).pipe(
    Effect.map((current) =>
      current.filter((line) => line.type === "desktop-startup-memory").map((line) => line.label),
    ),
  );
  return { clock, recorder, records, memoryLabels };
});

// With the shell interactive and the backend ready, the record also waits for the live shell.
const settleAll = (clock: StartupClock) => {
  for (const phase of REQUIRED_STARTUP_PHASES) clock.reach(phase);
  clock.reach("shellLive");
};

describe("makeStartupRecorder", () => {
  it.effect("writes one record as soon as every required phase resolves", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { clock, recorder, records } = yield* setup;
        yield* Effect.yieldNow;
        assert.deepStrictEqual(yield* records, []);

        settleAll(clock);
        yield* Effect.yieldNow;
        yield* recorder.flush;

        const written = yield* records;
        assert.strictEqual(written.length, 1);
        assert.strictEqual(written[0]?.outcome, "settled");
        assert.strictEqual(written[0]?.phases?.backendReady?.status, "reached");
      }),
    ),
  );

  it.effect("writes the unresolved phases as not reached at the deadline", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { clock, records } = yield* setup;
        clock.reach("mainEntry");
        yield* TestClock.adjust("119999 millis");
        assert.deepStrictEqual(yield* records, []);

        yield* TestClock.adjust("1 millis");
        const written = yield* records;
        assert.strictEqual(written.length, 1);
        assert.strictEqual(written[0]?.outcome, "deadline");
        assert.strictEqual(written[0]?.phases?.mainEntry?.status, "reached");
        assert.strictEqual(written[0]?.phases?.rendererFirstPaint?.status, "not-reached");
      }),
    ),
  );

  it.effect("writes the record on shutdown when the launch quits before it settles", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { clock, recorder, records } = yield* setup;
        yield* recorder.flush;
        settleAll(clock);
        yield* TestClock.adjust("120 seconds");

        const written = yield* records;
        assert.strictEqual(written.length, 1);
        assert.strictEqual(written[0]?.outcome, "shutdown");
      }),
    ),
  );

  it.effect("samples memory at 10 and 60 seconds after process start", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { memoryLabels } = yield* setup;
        yield* TestClock.adjust("9999 millis");
        assert.deepStrictEqual(yield* memoryLabels, []);

        yield* TestClock.adjust("1 millis");
        assert.deepStrictEqual(yield* memoryLabels, ["10s"]);

        yield* TestClock.adjust("50 seconds");
        assert.deepStrictEqual(yield* memoryLabels, ["10s", "60s"]);
      }),
    ),
  );
});
