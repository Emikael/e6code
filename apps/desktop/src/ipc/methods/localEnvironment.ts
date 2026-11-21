import { DesktopLocalEnvironmentStatusSchema } from "@e6tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as DesktopLifecycle from "../../app/DesktopLifecycle.ts";
import * as DesktopLocalBackendStatus from "../../backend/DesktopLocalBackendStatus.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopAppSettings from "../../settings/DesktopAppSettings.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod, makeSyncIpcMethod } from "../DesktopIpc.ts";

export const getLocalEnvironmentEnabled = makeSyncIpcMethod({
  channel: IpcChannels.GET_LOCAL_ENVIRONMENT_ENABLED_CHANNEL,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.localEnvironment.getEnabled")(function* () {
    const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
    return (yield* appSettings.get).localEnvironmentEnabled;
  }),
});

export const setLocalEnvironmentEnabled = makeIpcMethod({
  channel: IpcChannels.SET_LOCAL_ENVIRONMENT_ENABLED_CHANNEL,
  payload: Schema.Boolean,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.localEnvironment.setEnabled")(function* (enabled) {
    const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
    const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
    const change = yield* appSettings.setLocalEnvironmentEnabled(enabled);
    if (change.changed) {
      yield* lifecycle.relaunch(`localEnvironmentEnabled=${enabled}`);
    }
  }),
});

/** Read once, synchronously, by the renderer's first route decision. */
export const getLocalEnvironmentStatus = makeSyncIpcMethod({
  channel: IpcChannels.GET_LOCAL_ENVIRONMENT_STATUS_CHANNEL,
  result: Schema.NullOr(DesktopLocalEnvironmentStatusSchema),
  handler: Effect.fn("desktop.ipc.localEnvironment.getStatus")(function* () {
    const status = yield* DesktopLocalBackendStatus.DesktopLocalBackendStatus;
    return yield* status.get;
  }),
});

/** Pushes every status change to every window; the renderer keeps the latest. */
export const installLocalEnvironmentStatusForwarding = Effect.fn(
  "desktop.ipc.installLocalEnvironmentStatusForwarding",
)(function* () {
  const status = yield* DesktopLocalBackendStatus.DesktopLocalBackendStatus;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const encode = Schema.encodeEffect(DesktopLocalEnvironmentStatusSchema);
  yield* status.changes.pipe(
    Stream.drop(1),
    Stream.filter((value) => value !== null),
    Stream.runForEach((value) =>
      encode(value).pipe(
        Effect.flatMap((encoded) =>
          electronWindow.sendAll(IpcChannels.LOCAL_ENVIRONMENT_STATUS_CHANNEL, encoded),
        ),
        Effect.catch((error) =>
          Effect.logWarning("could not forward the local environment status", {
            error: error.message,
          }),
        ),
      ),
    ),
    Effect.forkScoped,
  );
});
