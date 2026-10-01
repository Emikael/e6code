import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { beforeEach, vi } from "vite-plus/test";

import type * as Electron from "electron";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopAppIdentity from "./DesktopAppIdentity.ts";
import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const { existsSyncMock } = vi.hoisted(() => ({ existsSyncMock: vi.fn() }));

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: existsSyncMock,
}));

const defaultEnvironmentInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "1.2.3",
  appPath: "/Applications/E6 Code.app/Contents/Resources/app.asar",
  isPackaged: true,
  resourcesPath: "/Applications/E6 Code.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

type TestEnvironmentInput = Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> & {
  readonly env?: Record<string, string | undefined>;
};

interface ElectronAppCalls {
  readonly setAboutPanelOptions: Array<Electron.AboutPanelOptionsOptions>;
  readonly setDockIcon: string[];
  readonly setName: string[];
}

const makeElectronAppLayer = (calls: ElectronAppCalls) =>
  Layer.succeed(ElectronApp.ElectronApp, {
    metadata: Effect.die("unexpected metadata read"),
    name: Effect.succeed("E6 Code"),
    systemLocale: Effect.succeed("en-US"),
    whenReady: Effect.void,
    quit: Effect.void,
    exit: () => Effect.void,
    relaunch: () => Effect.void,
    setPath: () => Effect.void,
    setName: (name) =>
      Effect.sync(() => {
        calls.setName.push(name);
      }),
    setAboutPanelOptions: (options) =>
      Effect.sync(() => {
        calls.setAboutPanelOptions.push(options);
      }),
    setAppUserModelId: () => Effect.void,
    getAppMetrics: Effect.succeed([]),
    setAsDefaultProtocolClient: () => Effect.succeed(true),
    setDesktopName: () => Effect.void,
    setDockIcon: (iconPath) =>
      Effect.sync(() => {
        calls.setDockIcon.push(iconPath);
      }),
    appendCommandLineSwitch: () => Effect.void,
    onBeforeQuitForUpdate: () => Effect.void,
    removeCommandLineSwitch: () => Effect.void,
    on: () => Effect.void,
  } satisfies ElectronApp.ElectronApp["Service"]);

const makeAssetsLayer = (png: Option.Option<string>) =>
  Layer.succeed(DesktopAssets.DesktopAssets, {
    iconPaths: Effect.succeed({
      ico: Option.none(),
      icns: Option.none(),
      png,
    }),
    resolveResourcePath: () => Effect.succeed(Option.none()),
  } satisfies DesktopAssets.DesktopAssets["Service"]);

const makeEnvironmentLayer = (overrides: TestEnvironmentInput = {}) => {
  const { env, ...environmentOverrides } = overrides;
  return DesktopEnvironment.layer({
    ...defaultEnvironmentInput,
    ...environmentOverrides,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        NodePath.layerPosix,
        DesktopConfig.layerTest({
          ...env,
        }),
      ),
    ),
  );
};

const withIdentity = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    | R
    | DesktopAppIdentity.DesktopAppIdentity
    | DesktopEnvironment.DesktopEnvironment
    | FileSystem.FileSystem
  >,
  input: {
    readonly calls?: ElectronAppCalls;
    readonly environment?: TestEnvironmentInput;
    readonly legacyPathExists?: boolean;
    readonly existingPathIncludes?: readonly string[];
    readonly legacyPathProbeError?: unknown;
    readonly packageJson?: string;
    readonly pngIconPath?: Option.Option<string>;
  } = {},
) => {
  const calls: ElectronAppCalls = input.calls ?? {
    setAboutPanelOptions: [],
    setDockIcon: [],
    setName: [],
  };
  // Synchronous by design: userData resolution must precede app.ready, so the
  // implementation uses existsSync and these tests drive it directly. Only the
  // legacy userData probe throws: environment construction also stats paths
  // while its layer builds.
  existsSyncMock.mockImplementation((path: unknown) => {
    const candidate = typeof path === "string" ? path : String(path);
    if (input.legacyPathProbeError !== undefined && candidate.includes("E6 Code (Alpha)")) {
      throw input.legacyPathProbeError;
    }
    return (
      input.existingPathIncludes ?? (input.legacyPathExists === true ? ["E6 Code (Alpha)"] : [])
    ).some((part) => candidate.includes(part));
  });

  return effect.pipe(
    Effect.provide(
      DesktopAppIdentity.layer.pipe(
        Layer.provideMerge(
          FileSystem.layerNoop({
            readFileString: () =>
              Effect.succeed(input.packageJson ?? '{"e6codeCommitHash":"abcdef1234567890"}'),
          }),
        ),
        Layer.provideMerge(makeAssetsLayer(input.pngIconPath ?? Option.none())),
        Layer.provideMerge(makeElectronAppLayer(calls)),
        Layer.provideMerge(makeEnvironmentLayer(input.environment)),
      ),
    ),
  );
};

describe("DesktopAppIdentity", () => {
  it.effect("keeps using the legacy userData path when it already exists", () =>
    withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        const userDataPath = yield* identity.resolveUserDataPath;

        assert.equal(userDataPath, "/Users/alice/Library/Application Support/E6 Code (Alpha)");
      }),
      { legacyPathExists: true },
    ),
  );

  it.effect("keeps using e6code userData when e6code has not been created", () =>
    withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        const userDataPath = yield* identity.resolveUserDataPath;

        assert.equal(userDataPath, "/Users/alice/Library/Application Support/e6code");
      }),
      { existingPathIncludes: ["e6code"] },
    ),
  );

  it.effect("preserves failures while inspecting the legacy userData path", () => {
    const legacyPath = "/Users/alice/Library/Application Support/E6 Code (Alpha)";
    // Synchronous by design: existsSync throws plain errors, not PlatformError.
    const cause = new Error("permission denied");

    return withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        const error = yield* identity.resolveUserDataPath.pipe(Effect.flip);

        assert.instanceOf(error, DesktopAppIdentity.DesktopUserDataPathResolutionError);
        assert.equal(error.legacyPath, legacyPath);
        assert.strictEqual(error.cause, cause);
        assert.equal(
          error.message,
          `Failed to inspect legacy desktop user-data path at "${legacyPath}".`,
        );
      }),
      { legacyPathProbeError: cause },
    );
  });

  it.effect("resolves without the async FileSystem service", () => {
    // Regression pin: userData resolution must precede app.ready for the Clerk
    // bridge's scheme registration, so it cannot yield to the event loop for
    // promise-based fs. Providing no FileSystem at all fails loudly if an
    // async dependency ever creeps back in.
    existsSyncMock.mockReturnValue(false);
    return Effect.gen(function* () {
      const userDataPath = yield* DesktopAppIdentity.resolveUserDataPath;
      assert.equal(userDataPath, "/Users/alice/Library/Application Support/e6code");
    }).pipe(
      Effect.provide(
        DesktopEnvironment.layer(defaultEnvironmentInput).pipe(
          Layer.provide(Layer.mergeAll(NodePath.layerPosix, DesktopConfig.layerTest({}))),
        ),
      ),
    );
  });

  it.effect("configures app identity from the environment commit override", () => {
    const calls: ElectronAppCalls = {
      setAboutPanelOptions: [],
      setDockIcon: [],
      setName: [],
    };

    return withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        yield* identity.configure;

        assert.deepEqual(calls.setName, ["E6 Code (Alpha)"]);
        assert.equal(calls.setAboutPanelOptions[0]?.applicationName, "E6 Code (Alpha)");
        assert.equal(calls.setAboutPanelOptions[0]?.applicationVersion, "1.2.3");
        assert.equal(calls.setAboutPanelOptions[0]?.version, "0123456789ab");
        // Packaged: the bundle's own icon stands, so a custom one the user
        // attached survives.
        assert.deepEqual(calls.setDockIcon, []);
      }),
      {
        calls,
        environment: {
          env: {
            E6CODE_COMMIT_HASH: "0123456789abcdef",
          },
        },
        pngIconPath: Option.some("/icon.png"),
      },
    );
  });

  it.effect("sets the dock icon only when running unpackaged", () => {
    const calls: ElectronAppCalls = {
      setAboutPanelOptions: [],
      setDockIcon: [],
      setName: [],
    };

    return withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        yield* identity.configure;

        // Electron shows a generic icon for an unpackaged run, which is the
        // reason this call exists at all.
        assert.deepEqual(calls.setDockIcon, ["/icon.png"]);
      }),
      {
        calls,
        environment: { isPackaged: false },
        pngIconPath: Option.some("/icon.png"),
      },
    );
  });
});
