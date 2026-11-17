import * as Effect from "effect/Effect";

import * as DesktopShellEnvironment from "../shell/DesktopShellEnvironment.ts";
import * as DesktopSnapShot from "../snapShot/DesktopSnapShot.ts";
import * as DesktopIpc from "./DesktopIpc.ts";
import { installNotificationBadge } from "./methods/notificationBadge.ts";
import { getMotionPowerState, installMotionPowerStateForwarding } from "./methods/motionPower.ts";
import { reportStartupMark } from "./methods/startupMarks.ts";
import { getClientSettings, setClientSettings } from "./methods/clientSettings.ts";
import {
  clearConnectionCatalog,
  getConnectionCatalog,
  setConnectionCatalog,
} from "./methods/connectionCatalog.ts";
import {
  getLocalEnvironmentEnabled,
  getLocalEnvironmentStatus,
  installLocalEnvironmentStatusForwarding,
  setLocalEnvironmentEnabled,
} from "./methods/localEnvironment.ts";
import {
  getAdvertisedEndpoints,
  getServerExposureState,
  setServerExposureMode,
  setTailscaleServeEnabled,
} from "./methods/serverExposure.ts";
import {
  bootstrapSshBearerSession,
  disconnectSshEnvironment,
  discoverSshHosts,
  ensureSshEnvironment,
  fetchSshEnvironmentDescriptor,
  fetchSshSessionState,
  issueSshWebSocketTicket,
  resolveSshHost,
  resolveSshPasswordPrompt,
} from "./methods/sshEnvironment.ts";
import {
  checkForUpdate,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  setUpdateChannel,
} from "./methods/updates.ts";
import {
  getAppBranding,
  getLocalEnvironmentBootstraps,
  getLocalEnvironmentBearerToken,
  getSystemLocale,
  getWindowFullscreenState,
  openExternal,
  openSystemSettings,
  checkSystemPermission,
  pasteAsText,
  probeRemoteEditors,
  pickFolder,
  pickProjectFavicon,
  pickThemeFiles,
  setTheme,
  showContextMenu,
} from "./methods/window.ts";
import {
  acknowledgeSnapShot,
  checkSnapShotShortcut,
  dismissSnapShotAnimation,
  getSnapShotState,
  setupSnapShot,
  previewSnapShotConfig,
  applySnapShotConfig,
  listPendingSnapShots,
  readSnapShot,
  requestSnapShotPermissions,
  setSnapShotAnimationDestination,
  setSnapShotShortcutSuppressed,
} from "./methods/snapShot.ts";
import * as PreviewIpc from "./methods/preview.ts";
import * as AppActivationIpc from "./methods/appActivation.ts";
import { getWslState, setWslBackendEnabled, setWslDistro, setWslOnly } from "./methods/wsl.ts";

export const installDesktopIpcHandlers = Effect.fn("desktop.ipc.installHandlers")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const shellEnvironment = yield* DesktopShellEnvironment.DesktopShellEnvironment;
  const snapShot = yield* DesktopSnapShot.DesktopSnapShot;
  // The renderer is up before the login-shell import finishes. Methods that spawn something
  // needing the user's PATH, SSH agent or desktop session wait for the import; SnapShot methods
  // wait for SnapShot's own initialization, which runs after the import.
  const afterShellEnvironment = DesktopIpc.afterGate(shellEnvironment.awaitInstalled);
  const afterSnapShot = DesktopIpc.afterGate(snapShot.awaitInitialized);
  yield* installNotificationBadge();
  yield* PreviewIpc.installPreviewEventForwarding();
  yield* installMotionPowerStateForwarding();
  yield* installLocalEnvironmentStatusForwarding();

  yield* ipc.handle(AppActivationIpc.setReady);
  yield* ipc.handle(AppActivationIpc.complete);

  yield* ipc.handleSync(getAppBranding);
  yield* ipc.handleSync(getSystemLocale);
  yield* ipc.handleSync(getMotionPowerState);
  yield* ipc.handle(reportStartupMark);
  yield* ipc.handleSync(getWindowFullscreenState);
  yield* ipc.handleSync(getLocalEnvironmentBootstraps);
  yield* ipc.handleSync(getLocalEnvironmentEnabled);
  yield* ipc.handleSync(getLocalEnvironmentStatus);
  yield* ipc.handle(setLocalEnvironmentEnabled);
  yield* ipc.handle(getLocalEnvironmentBearerToken);

  yield* ipc.handle(getClientSettings);
  yield* ipc.handle(setClientSettings);
  yield* ipc.handle(getConnectionCatalog);
  yield* ipc.handle(afterSnapShot(getSnapShotState));
  yield* ipc.handle(afterSnapShot(setupSnapShot));
  yield* ipc.handle(afterSnapShot(previewSnapShotConfig));
  yield* ipc.handle(afterSnapShot(applySnapShotConfig));
  yield* ipc.handle(requestSnapShotPermissions);
  yield* ipc.handle(afterSnapShot(checkSnapShotShortcut));
  yield* ipc.handle(setSnapShotShortcutSuppressed);
  yield* ipc.handle(listPendingSnapShots);
  yield* ipc.handle(readSnapShot);
  yield* ipc.handle(setSnapShotAnimationDestination);
  yield* ipc.handle(dismissSnapShotAnimation);
  yield* ipc.handle(acknowledgeSnapShot);
  yield* ipc.handle(setConnectionCatalog);
  yield* ipc.handle(clearConnectionCatalog);

  yield* ipc.handle(discoverSshHosts);
  yield* ipc.handle(afterShellEnvironment(resolveSshHost));
  yield* ipc.handle(afterShellEnvironment(ensureSshEnvironment));
  yield* ipc.handle(afterShellEnvironment(disconnectSshEnvironment));
  yield* ipc.handle(fetchSshEnvironmentDescriptor);
  yield* ipc.handle(bootstrapSshBearerSession);
  yield* ipc.handle(fetchSshSessionState);
  yield* ipc.handle(issueSshWebSocketTicket);
  yield* ipc.handle(resolveSshPasswordPrompt);

  yield* ipc.handle(getServerExposureState);
  yield* ipc.handle(setServerExposureMode);
  yield* ipc.handle(setTailscaleServeEnabled);
  yield* ipc.handle(afterShellEnvironment(getAdvertisedEndpoints));

  yield* ipc.handle(getWslState);
  yield* ipc.handle(afterShellEnvironment(setWslBackendEnabled));
  yield* ipc.handle(afterShellEnvironment(setWslDistro));
  yield* ipc.handle(setWslOnly);

  yield* ipc.handle(pickFolder);
  yield* ipc.handle(pickProjectFavicon);
  yield* ipc.handle(pickThemeFiles);
  yield* ipc.handle(setTheme);
  yield* ipc.handle(showContextMenu);
  yield* ipc.handle(openExternal);
  yield* ipc.handle(openSystemSettings);
  yield* ipc.handle(checkSystemPermission);
  yield* ipc.handle(pasteAsText);
  yield* ipc.handle(afterShellEnvironment(probeRemoteEditors));
  yield* ipc.handle(getUpdateState);
  yield* ipc.handle(setUpdateChannel);
  yield* ipc.handle(downloadUpdate);
  yield* ipc.handle(installUpdate);
  yield* ipc.handle(checkForUpdate);
  for (const previewMethod of PreviewIpc.methods) {
    yield* ipc.handle(previewMethod);
  }
  yield* ipc.handle(afterShellEnvironment(PreviewIpc.listBrowserImportSources));
  yield* ipc.handle(afterShellEnvironment(PreviewIpc.importBrowserCookies));
});
