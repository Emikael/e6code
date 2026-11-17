// @effect-diagnostics nodeBuiltinImport:off - reads the machine's login and hostname for the local-only leak check.
import * as NodeOS from "node:os";

import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { listCorpusFiles, readCorpusFile } from "./corpus.ts";
import { decodeRecording, encodeRecording } from "./recording.ts";
import { findLeaks, scrubRecording } from "./scrub.ts";

const files = listCorpusFiles();

/**
 * The recording machine's own login and hostname. CI runs as a generic user,
 * so the check only means something on a developer machine, where it catches
 * a recording committed without passing through the scrub command.
 */
function localIdentities(): ReadonlyArray<string> {
  if (process.env.CI) return [];
  const hostname = NodeOS.hostname();
  return [NodeOS.userInfo().username, hostname, hostname.split(".")[0] ?? ""].filter(
    (value) => value.length >= 4 && value.toLowerCase() !== "localhost",
  );
}

describe("provider replay corpus", () => {
  it("has hand-made fixtures to replay", () => {
    expect(files.filter((file) => file.kind === "fixture").length).toBeGreaterThan(0);
  });

  for (const file of files) {
    describe(`${file.kind}s/${file.name}`, () => {
      it.effect("decodes against the runtime event contract in canonical encoding", () =>
        Effect.gen(function* () {
          const text = readCorpusFile(file);
          const recording = yield* decodeRecording(text);

          // Byte-identical to its canonical encoding, so no field the schema
          // does not know can sit in the file unseen by the leak check.
          expect(encodeRecording(recording)).toBe(text);
          expect(recording.header.source).toBe(file.kind === "fixture" ? "hand-made" : "recorded");
        }),
      );

      it.effect("is already scrubbed and leaks nothing", () =>
        Effect.gen(function* () {
          const recording = yield* decodeRecording(readCorpusFile(file));

          expect(findLeaks(recording, { identities: localIdentities() })).toEqual([]);
          assert.deepStrictEqual(scrubRecording(recording), recording);
        }),
      );
    });
  }
});
