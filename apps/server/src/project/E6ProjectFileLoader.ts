/**
 * E6ProjectFileLoader - Effect service that loads the checked-in `e6.json`
 * project file from a workspace root.
 *
 * Loading is best-effort: a missing file resolves to `Option.none`, and
 * unreadable or invalid files are logged and treated as absent so callers
 * can fall back to their defaults.
 *
 * @module E6ProjectFileLoader
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  LEGACY_E6_PROJECT_FILE_NAME,
  E6_PROJECT_FILE_NAME,
  type E6ProjectFile,
} from "@e6tools/contracts";
import { E6ProjectFileFromJson } from "@e6tools/shared/e6ProjectFile";

const decodeE6ProjectFileJson = Schema.decodeEffect(E6ProjectFileFromJson);

export class E6ProjectFileLoadError extends Schema.TaggedError<E6ProjectFileLoadError>()(
  "E6ProjectFileLoadError",
  {
    operation: Schema.Literals(["read", "decode"]),
    workspaceRoot: Schema.String,
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} ${E6_PROJECT_FILE_NAME} at ${this.filePath}.`;
  }
}

/** Service tag for e6.json project file loading. */
export class E6ProjectFileLoader extends Context.Service<
  E6ProjectFileLoader,
  {
    /**
     * Load and decode `e6.json` at the workspace root.
     *
     * Never fails: missing, unreadable, or invalid files resolve to
     * `Option.none` (invalid files are logged as warnings).
     */
    readonly load: (workspaceRoot: string) => Effect.Effect<Option.Option<E6ProjectFile>>;
  }
>()("e6/project/E6ProjectFileLoader") {}

const logE6ProjectFileLoadError = (error: E6ProjectFileLoadError) =>
  Effect.logWarning(error).pipe(
    Effect.annotateLogs({
      operation: error.operation,
      workspaceRoot: error.workspaceRoot,
      filePath: error.filePath,
      errorTag: error._tag,
    }),
  );

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const load: E6ProjectFileLoader["Service"]["load"] = Effect.fn("E6ProjectFileLoader.load")(
    function* (workspaceRoot) {
      const primaryPath = path.join(workspaceRoot, E6_PROJECT_FILE_NAME);
      const legacyPath = path.join(workspaceRoot, LEGACY_E6_PROJECT_FILE_NAME);
      const primaryExists = yield* fileSystem
        .exists(primaryPath)
        .pipe(Effect.orElseSucceed(() => false));
      const filePath = primaryExists ? primaryPath : legacyPath;
      const raw = yield* fileSystem.readFileString(filePath).pipe(
        Effect.map(Option.some),
        Effect.catchTags({
          PlatformError: (error) =>
            error.reason._tag === "NotFound"
              ? Effect.succeed(Option.none<string>())
              : logE6ProjectFileLoadError(
                  new E6ProjectFileLoadError({
                    operation: "read",
                    workspaceRoot,
                    filePath,
                    cause: error,
                  }),
                ).pipe(Effect.as(Option.none<string>())),
        }),
      );
      if (Option.isNone(raw)) {
        return Option.none<E6ProjectFile>();
      }
      return yield* decodeE6ProjectFileJson(raw.value).pipe(
        Effect.map(Option.some),
        Effect.catchTags({
          SchemaError: (error) =>
            logE6ProjectFileLoadError(
              new E6ProjectFileLoadError({
                operation: "decode",
                workspaceRoot,
                filePath,
                cause: error,
              }),
            ).pipe(Effect.as(Option.none<E6ProjectFile>())),
        }),
      );
    },
  );

  return E6ProjectFileLoader.of({ load });
});

export const layer = Layer.effect(E6ProjectFileLoader, make);
