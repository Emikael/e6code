/**
 * ClaudeDriver — `ProviderDriver` for the Claude Agent SDK runtime.
 *
 * Mirrors `CodexDriver`: a plain value whose `create()` returns one
 * `ProviderInstance` bundling `snapshot` / `adapter` / `textGeneration`
 * closures captured over the per-instance `ClaudeSettings`.
 *
 * Unlike Codex, the Claude snapshot probe may invoke a secondary probe
 * (`probeClaudeCapabilities`) to read Anthropic account + slash-command
 * metadata. That probe is per-instance and keyed by binary + resolved HOME so
 * two concurrent Claude instances don't cross-contaminate account metadata.
 *
 * @module provider/Drivers/ClaudeDriver
 */
import { ClaudeSettings, ProviderDriverKind } from "@e6tools/contracts";
import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import { makeClaudeTextGeneration } from "../../textGeneration/ClaudeTextGeneration.ts";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { expandHomePath } from "../../pathExpansion.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeClaudeAdapter } from "../Layers/ClaudeAdapter.ts";
import { makeClaudeScopedLimitNames } from "../Layers/claudeUsageLimits.ts";
import {
  checkClaudeProviderStatus,
  makePendingClaudeProvider,
  probeClaudeCapabilities,
} from "../Layers/ClaudeProvider.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { resolveClaudeModelCatalog } from "../ClaudeModelCatalog.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import * as ModelManifest from "../ModelManifest.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { withInstanceIdentity } from "./instanceIdentity.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  makeCachedProviderMaintenanceResolution,
  makePackageManagedProviderMaintenanceResolver,
  normalizeCommandPath,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";
import { makeClaudeContinuationGroupKey } from "./ClaudeHome.ts";
import {
  discoverClaudeSkills,
  makeClaudeSessionSkillNames,
  mergeClaudeSkillCatalog,
  resolveClaudeNativeSkills,
} from "./ClaudeSkills.ts";
const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);

const DRIVER_KIND = ProviderDriverKind.make("claudeAgent");
const CAPABILITIES_PROBE_TTL = Duration.minutes(5);

function isClaudeNativeCommandPath(commandPath: string): boolean {
  const normalized = normalizeCommandPath(commandPath);
  return (
    normalized.endsWith("/.local/bin/claude") ||
    normalized.endsWith("/.local/bin/claude.exe") ||
    normalized.includes("/.local/share/claude/")
  );
}

const UPDATE = makePackageManagedProviderMaintenanceResolver({
  provider: DRIVER_KIND,
  npmPackageName: "@anthropic-ai/claude-code",
  nativeUpdate: {
    args: ["update"],
    isCommandPath: isClaudeNativeCommandPath,
  },
});

export type ClaudeDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | ModelManifest.ModelManifest
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig
  | ServerSettingsService;

export const ClaudeDriver: ProviderDriver<ClaudeSettings, ClaudeDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Claude",
    supportsMultipleInstances: true,
  },
  configSchema: ClaudeSettings,
  defaultConfig: (): ClaudeSettings => decodeClaudeSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { cwd, providerStatusCacheDir } = yield* ServerConfig;
      const httpClient = yield* HttpClient.HttpClient;
      const serverSettings = yield* ServerSettingsService;
      const eventLoggers = yield* ProviderEventLoggers;
      const modelManifest = yield* ModelManifest.ModelManifest;
      const modelCatalog = modelManifest.current.pipe(Effect.map(resolveClaudeModelCatalog));
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const fallbackContinuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const effectiveConfig = {
        ...config,
        enabled,
        binaryPath: expandHomePath(config.binaryPath),
      } satisfies ClaudeSettings;
      const resolveMaintenance = yield* makeCachedProviderMaintenanceResolution(
        resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
          binaryPath: effectiveConfig.binaryPath,
          env: processEnv,
        }).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        ),
      );
      const continuationGroupKey = yield* makeClaudeContinuationGroupKey(
        effectiveConfig,
        processEnv,
      );
      const stampIdentity = withInstanceIdentity({
        instanceId,
        driverKind: DRIVER_KIND,
        displayName,
        accentColor,
        continuationGroupKey,
      });

      // One per instance: the status probe writes the model-scoped bucket
      // names it saw, the adapter reads them to place turn-driven events.
      const scopedLimitNames = yield* makeClaudeScopedLimitNames;
      // Skill names live sessions announced in `system/init`. Only they tell
      // user-only bundled skills from terminal commands, and only after a
      // turn, so they persist for workspace catalogs built after a restart.
      const sessionSkills = yield* makeClaudeSessionSkillNames(
        path.join(providerStatusCacheDir, "claude-session-skills", `${instanceId}.json`),
      ).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );

      // The instance owns its binary and HOME; workspace keys keep native catalogs isolated.
      const capabilitiesProbeCache = yield* Cache.make({
        capacity: 32,
        timeToLive: CAPABILITIES_PROBE_TTL,
        lookup: (workspaceCwd: string) =>
          probeClaudeCapabilities(effectiveConfig, processEnv, workspaceCwd).pipe(
            Effect.provideService(Path.Path, path),
          ),
      });

      /** The `$` catalog for a workspace; the menu and turn dispatch both read it. */
      const skillCatalogForCwd = (workspaceCwd: string) =>
        Effect.all([
          discoverClaudeSkills(effectiveConfig, workspaceCwd, processEnv),
          Cache.get(capabilitiesProbeCache, workspaceCwd),
          Ref.get(sessionSkills.names),
        ]).pipe(
          Effect.map(([skills, capabilities, sessionSkills]) => ({
            capabilities,
            skills: mergeClaudeSkillCatalog(
              skills,
              resolveClaudeNativeSkills(capabilities?.nativeSkills, sessionSkills),
            ),
          })),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        );

      const adapterOptions = {
        instanceId,
        environment: processEnv,
        modelCatalog,
        scopedLimitNames,
        recordSessionSkills: sessionSkills.record,
        skillCatalog: (workspaceCwd: string) =>
          skillCatalogForCwd(workspaceCwd).pipe(Effect.map(({ skills }) => skills)),
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
      };
      const adapter = yield* makeClaudeAdapter(effectiveConfig, adapterOptions);
      const textGeneration = yield* makeClaudeTextGeneration(
        effectiveConfig,
        processEnv,
        modelCatalog,
      );

      // Start the TTL-gated refresh without delaying provider readiness. The
      // next check observes a remote manifest after the background fetch lands.
      const checkProvider = modelManifest.refreshInBackground.pipe(
        Effect.andThen(
          modelManifest.current.pipe(
            Effect.flatMap((manifest) =>
              checkClaudeProviderStatus(
                effectiveConfig,
                () => Cache.get(capabilitiesProbeCache, cwd),
                processEnv,
                cwd,
                resolveClaudeModelCatalog(manifest),
                scopedLimitNames,
              ),
            ),
            Effect.map(stampIdentity),
          ),
        ),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );

      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<ClaudeSettings>>({
        resolveMaintenance,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          modelManifest.current.pipe(
            Effect.flatMap((manifest) =>
              makePendingClaudeProvider(settings.provider, resolveClaudeModelCatalog(manifest)),
            ),
            Effect.map(stampIdentity),
          ),
        checkProvider,
        enrichSnapshot: ({ settings, snapshot, publishSnapshot }) =>
          resolveMaintenance().pipe(
            Effect.flatMap((maintenanceCapabilities) =>
              enrichProviderSnapshotWithVersionAdvisory(snapshot, maintenanceCapabilities, {
                enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
              }),
            ),
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.flatMap((enrichedSnapshot) => publishSnapshot(enrichedSnapshot)),
          ),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Claude snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );
      const snapshotForCwd = (cwd: string) =>
        !effectiveConfig.enabled
          ? snapshot.getSnapshot
          : Effect.all([snapshot.getSnapshot, skillCatalogForCwd(cwd)]).pipe(
              Effect.map(([machineSnapshot, { skills, capabilities }]) => ({
                ...machineSnapshot,
                skills,
                ...(capabilities
                  ? { slashCommands: [{ name: "compact" }, ...capabilities.slashCommands] }
                  : {}),
              })),
            );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity: {
          ...fallbackContinuationIdentity,
          continuationKey: continuationGroupKey,
        },
        displayName,
        accentColor,
        enabled,
        snapshot,
        snapshotForCwd,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
