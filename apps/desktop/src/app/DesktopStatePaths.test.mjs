// JavaScript on purpose: the desktop's TypeScript project cannot reference server sources,
// and this test exists to compare the two.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as NodePath from "node:path";

import { deriveServerPaths } from "../../../server/src/config.ts";
import {
  resolveDesktopBaseDir,
  resolveDesktopStateDir,
  resolveLocalEnvironmentIdPath,
} from "./DesktopStatePaths.ts";

const HOME = "/Users/alice";
const DEV_URL = "http://127.0.0.1:5733/";

describe("DesktopStatePaths", () => {
  // The desktop reads the environment id the backend persisted, so both must derive the same
  // state directory. The backend inherits VITE_DEV_SERVER_URL and E6CODE_HOME from the
  // desktop's environment, and receives the desktop's base dir as the bootstrap `e6Home`,
  // which it does not treat as explicit.
  for (const devServerUrl of [null, DEV_URL]) {
    for (const e6Home of [null, "/srv/e6-isolated"]) {
      it.effect(
        `agrees with the server on the environment-id path (dev=${devServerUrl !== null}, E6CODE_HOME=${e6Home !== null})`,
        () =>
          Effect.gen(function* () {
            const configuredHome = Option.fromNullishOr(e6Home);
            const baseDir = resolveDesktopBaseDir({
              homeDirectory: HOME,
              joinPath: NodePath.join,
              e6Home: configuredHome,
              exists: () => false,
            });
            const desktopPath = resolveLocalEnvironmentIdPath(
              resolveDesktopStateDir({
                baseDir,
                isDevelopment: devServerUrl !== null,
                joinPath: NodePath.join,
                e6Home: configuredHome,
              }),
              NodePath.join,
            );

            const serverPaths = yield* deriveServerPaths(
              e6Home ?? baseDir,
              devServerUrl === null ? undefined : new URL(devServerUrl),
              { baseDirIsExplicit: e6Home !== null },
            );

            assert.strictEqual(desktopPath, serverPaths.environmentIdPath);
            assert.strictEqual(
              NodePath.basename(NodePath.dirname(desktopPath)),
              devServerUrl !== null && e6Home === null ? "dev" : "userdata",
            );
          }).pipe(Effect.provide(NodeServices.layer)),
      );
    }
  }
});
