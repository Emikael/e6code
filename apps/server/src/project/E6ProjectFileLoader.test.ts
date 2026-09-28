import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as E6ProjectFileLoader from "./E6ProjectFileLoader.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(E6ProjectFileLoader.layer),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "e6code-project-file-",
  });
});

const writeProjectFile = Effect.fn("writeProjectFile")(function* (cwd: string, contents: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.writeFileString(path.join(cwd, "e6.json"), contents).pipe(Effect.orDie);
});

it.layer(TestLayer)("E6ProjectFileLoader", (it) => {
  describe("load", () => {
    it.effect("loads and decodes a valid e6.json", () =>
      Effect.gen(function* () {
        const loader = yield* E6ProjectFileLoader.E6ProjectFileLoader;
        const cwd = yield* makeTempDir;
        yield* writeProjectFile(
          cwd,
          `{
            // JSONC is tolerated
            "iconPath": "assets/logo.svg",
            "scripts": [{ "name": "Dev", "command": "pnpm dev" }],
          }`,
        );

        const loaded = yield* loader.load(cwd);

        expect(Option.isSome(loaded)).toBe(true);
        if (Option.isSome(loaded)) {
          expect(loaded.value.iconPath).toBe("assets/logo.svg");
          expect(loaded.value.scripts).toEqual([{ name: "Dev", command: "pnpm dev" }]);
        }
      }),
    );

    it.effect("prefers e6.json over e6.json", () =>
      Effect.gen(function* () {
        const loader = yield* E6ProjectFileLoader.E6ProjectFileLoader;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeProjectFile(cwd, `{ "iconPath": "legacy.svg" }`);
        yield* fileSystem.writeFileString(path.join(cwd, "e6.json"), `{ "iconPath": "next.svg" }`);

        const loaded = yield* loader.load(cwd);

        expect(Option.isSome(loaded) && loaded.value.iconPath).toBe("next.svg");
      }),
    );

    it.effect("returns none when e6.json is missing", () =>
      Effect.gen(function* () {
        const loader = yield* E6ProjectFileLoader.E6ProjectFileLoader;
        const cwd = yield* makeTempDir;

        const loaded = yield* loader.load(cwd);

        expect(Option.isNone(loaded)).toBe(true);
      }),
    );

    it.effect("returns none for malformed JSON without failing", () =>
      Effect.gen(function* () {
        const loader = yield* E6ProjectFileLoader.E6ProjectFileLoader;
        const cwd = yield* makeTempDir;
        yield* writeProjectFile(cwd, "{ not json");

        const loaded = yield* loader.load(cwd);

        expect(Option.isNone(loaded)).toBe(true);
      }),
    );

    it.effect("returns none for schema-invalid files without failing", () =>
      Effect.gen(function* () {
        const loader = yield* E6ProjectFileLoader.E6ProjectFileLoader;
        const cwd = yield* makeTempDir;
        yield* writeProjectFile(cwd, '{ "scripts": [{ "name": "Dev" }] }');

        const loaded = yield* loader.load(cwd);

        expect(Option.isNone(loaded)).toBe(true);
      }),
    );
  });
});
