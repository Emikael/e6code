import {
  DesktopPreviewAnnotationThemeInputSchema,
  DesktopPreviewArtifactInputSchema,
  DesktopPreviewAutomationClickInputSchema,
  DesktopPreviewAutomationEvaluateInputSchema,
  DesktopPreviewAutomationPressInputSchema,
  DesktopPreviewAutomationScrollInputSchema,
  DesktopPreviewAutomationStatusSchema,
  DesktopPreviewAutomationTypeInputSchema,
  DesktopPreviewAutomationWaitForInputSchema,
  DesktopPreviewConfigInputSchema,
  DesktopPreviewNavigateInputSchema,
  DesktopPreviewRecordingArtifactSchema,
  DesktopPreviewRecordingSaveInputSchema,
  DesktopPreviewRegisterWebviewInputSchema,
  DesktopPreviewScreenshotArtifactSchema,
  DesktopPreviewSetAudioMutedInputSchema,
  DesktopPreviewSetColorSchemeInputSchema,
  BrowserImportResult,
  BrowserImportSource,
  DesktopPreviewAgentCookieAccessSchema,
  DesktopPreviewAgentCookieAccessInputSchema,
  DesktopPreviewAgentCookiePromptSchema,
  DesktopPreviewClearDataInputSchema,
  DesktopPreviewImportCookiesInputSchema,
  DesktopPreviewCreateTabInputSchema,
  DesktopPreviewTabInputSchema,
  DesktopPreviewWebviewConfigSchema,
  PreviewAnnotationSubmissionResultSchema,
  PreviewAutomationSnapshot,
  AGENT_BROWSER_PROFILE_ID,
} from "@e6tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as NodeURL from "node:url";

import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as AgentImportedCookieAccess from "../../preview/AgentImportedCookieAccess.ts";
import * as BrowserImport from "../../preview/BrowserImport/BrowserImport.ts";
import { BROWSER_IMPORT_SOURCES } from "../../preview/BrowserImport/Sources.ts";
import * as PreviewManager from "../../preview/Manager.ts";
import { resolvePartitionScope } from "../../preview/PartitionScope.ts";
import * as DesktopClientSettings from "../../settings/DesktopClientSettings.ts";
import { PREVIEW_WEBVIEW_PREFERENCES } from "../../preview/WebviewPreferences.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const installPreviewEventForwarding = Effect.fn(
  "desktop.ipc.preview.installEventForwarding",
)(function* () {
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const manager = yield* PreviewManager.PreviewManager;
  yield* manager.subscribeStateChanges((tabId, state) =>
    electronWindow.sendAll(IpcChannels.PREVIEW_STATE_CHANGE_CHANNEL, tabId, state),
  );
  yield* manager.subscribeRecordingFrames((frame) =>
    electronWindow.sendAll(IpcChannels.PREVIEW_RECORDING_FRAME_CHANNEL, frame),
  );
  yield* manager.subscribeRecordingInputs((event) =>
    electronWindow.sendAll(IpcChannels.PREVIEW_RECORDING_INPUT_CHANNEL, event),
  );
  yield* manager.subscribePointerEvents((event) =>
    electronWindow.sendAll(IpcChannels.PREVIEW_POINTER_EVENT_CHANNEL, event),
  );
});

export const createTab = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_CREATE_TAB_CHANNEL,
  payload: DesktopPreviewCreateTabInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.createTab")(function* ({
    tabId,
    zoomFactor,
    colorScheme,
  }) {
    const manager = yield* PreviewManager.PreviewManager;
    yield* manager.createTab(tabId, { zoomFactor, colorScheme });
  }),
});

export const closeTab = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_CLOSE_TAB_CHANNEL,
  payload: DesktopPreviewTabInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.closeTab")(function* ({ tabId }) {
    const manager = yield* PreviewManager.PreviewManager;
    yield* manager.closeTab(tabId);
  }),
});

export const registerWebview = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_REGISTER_WEBVIEW_CHANNEL,
  payload: DesktopPreviewRegisterWebviewInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.registerWebview")(function* ({ tabId, webContentsId }) {
    const manager = yield* PreviewManager.PreviewManager;
    yield* manager.registerWebview(tabId, webContentsId);
  }),
});

export const navigate = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_NAVIGATE_CHANNEL,
  payload: DesktopPreviewNavigateInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.navigate")(function* ({
    tabId,
    url,
    actor,
    environmentId,
    profileId,
  }) {
    const manager = yield* PreviewManager.PreviewManager;
    yield* manager.navigate(tabId, url, {
      actor,
      ...(environmentId === undefined ? {} : { environmentId }),
      ...(profileId === undefined ? {} : { profileId }),
    });
  }),
});

const tabMethod = (
  channel: string,
  name: string,
  invoke: (
    manager: PreviewManager.PreviewManager["Service"],
    tabId: string,
  ) => Effect.Effect<void, PreviewManager.PreviewManagerError>,
) =>
  DesktopIpc.makeIpcMethod({
    channel,
    payload: DesktopPreviewTabInputSchema,
    result: Schema.Void,
    handler: Effect.fn(name)(function* ({ tabId }) {
      const manager = yield* PreviewManager.PreviewManager;
      yield* invoke(manager, tabId);
    }),
  });

export const goBack = tabMethod(
  IpcChannels.PREVIEW_GO_BACK_CHANNEL,
  "desktop.ipc.preview.goBack",
  (manager, tabId) => manager.goBack(tabId),
);
export const goForward = tabMethod(
  IpcChannels.PREVIEW_GO_FORWARD_CHANNEL,
  "desktop.ipc.preview.goForward",
  (manager, tabId) => manager.goForward(tabId),
);
export const refresh = tabMethod(
  IpcChannels.PREVIEW_REFRESH_CHANNEL,
  "desktop.ipc.preview.refresh",
  (manager, tabId) => manager.refresh(tabId),
);
export const zoomIn = tabMethod(
  IpcChannels.PREVIEW_ZOOM_IN_CHANNEL,
  "desktop.ipc.preview.zoomIn",
  (manager, tabId) => manager.zoomIn(tabId),
);
export const zoomOut = tabMethod(
  IpcChannels.PREVIEW_ZOOM_OUT_CHANNEL,
  "desktop.ipc.preview.zoomOut",
  (manager, tabId) => manager.zoomOut(tabId),
);
export const resetZoom = tabMethod(
  IpcChannels.PREVIEW_RESET_ZOOM_CHANNEL,
  "desktop.ipc.preview.resetZoom",
  (manager, tabId) => manager.resetZoom(tabId),
);
export const hardReload = tabMethod(
  IpcChannels.PREVIEW_HARD_RELOAD_CHANNEL,
  "desktop.ipc.preview.hardReload",
  (manager, tabId) => manager.hardReload(tabId),
);
export const setColorScheme = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_SET_COLOR_SCHEME_CHANNEL,
  payload: DesktopPreviewSetColorSchemeInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.setColorScheme")(function* ({ tabId, colorScheme }) {
    const manager = yield* PreviewManager.PreviewManager;
    yield* manager.setColorScheme(tabId, colorScheme);
  }),
});
export const setAudioMuted = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_SET_AUDIO_MUTED_CHANNEL,
  payload: DesktopPreviewSetAudioMutedInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.setAudioMuted")(function* ({ tabId, audioMuted }) {
    const manager = yield* PreviewManager.PreviewManager;
    yield* manager.setAudioMuted(tabId, audioMuted);
  }),
});
export const openDevTools = tabMethod(
  IpcChannels.PREVIEW_OPEN_DEVTOOLS_CHANNEL,
  "desktop.ipc.preview.openDevTools",
  (manager, tabId) => manager.openDevTools(tabId),
);
export const cancelPickElement = tabMethod(
  IpcChannels.PREVIEW_CANCEL_PICK_ELEMENT_CHANNEL,
  "desktop.ipc.preview.cancelPickElement",
  (manager, tabId) => manager.cancelPickElement(tabId),
);
export const startRecording = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_RECORDING_START_CHANNEL,
  payload: DesktopPreviewTabInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.startRecording")(function* ({ tabId }) {
    const manager = yield* PreviewManager.PreviewManager;
    const store = yield* DesktopClientSettings.DesktopClientSettings;
    const settings = yield* store.get;
    const options = Option.map(settings, (value) => ({
      showKeyPresses: value.browserRecordingShowKeyPresses,
      showMousePresses: value.browserRecordingShowMousePresses,
    }));
    yield* manager.startRecording(tabId, Option.getOrUndefined(options));
  }),
});
export const stopRecording = tabMethod(
  IpcChannels.PREVIEW_RECORDING_STOP_CHANNEL,
  "desktop.ipc.preview.stopRecording",
  (manager, tabId) => manager.stopRecording(tabId),
);
export const openPictureInPicture = tabMethod(
  IpcChannels.PREVIEW_PICTURE_IN_PICTURE_OPEN_CHANNEL,
  "desktop.ipc.preview.openPictureInPicture",
  (manager, tabId) => manager.openPictureInPicture(tabId),
);
export const closePictureInPicture = tabMethod(
  IpcChannels.PREVIEW_PICTURE_IN_PICTURE_CLOSE_CHANNEL,
  "desktop.ipc.preview.closePictureInPicture",
  (manager, tabId) => manager.closePictureInPicture(tabId),
);

export const clearCookies = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_CLEAR_COOKIES_CHANNEL,
  payload: DesktopPreviewClearDataInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.clearCookies")(function* ({ environmentId, profileId }) {
    const manager = yield* PreviewManager.PreviewManager;
    yield* manager.clearCookies(yield* resolveClearPartitions(manager, environmentId, profileId));
  }),
});

export const clearCache = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_CLEAR_CACHE_CHANNEL,
  payload: DesktopPreviewClearDataInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.clearCache")(function* ({ environmentId, profileId }) {
    const manager = yield* PreviewManager.PreviewManager;
    yield* manager.clearCache(yield* resolveClearPartitions(manager, environmentId, profileId));
  }),
});

export { resolvePartitionScope };

/**
 * Clearing without a profile keeps the historical "everything" behaviour for
 * an explicit all-profiles action; naming a profile confines it to that
 * profile's partition so one profile's sign-out cannot reach the others.
 */
const resolveClearPartitions = Effect.fn("desktop.ipc.preview.resolveClearPartitions")(function* (
  manager: PreviewManager.PreviewManager["Service"],
  environmentId: string,
  profileId: string | undefined,
) {
  if (profileId === undefined) return undefined;
  const { scope, persistent, namespace } = resolvePartitionScope(environmentId, profileId);
  // Loading the session is what puts the partition in the map the clear walks.
  // Deriving the partition string alone leaves nothing to match, so clearing a
  // profile with no tab open this run — after a restart, or when deleting a
  // profile — would report success and delete nothing.
  yield* manager.getBrowserSession(scope, persistent, namespace);
  return [yield* manager.getBrowserPartition(scope, persistent, namespace)];
});

export const getPreviewConfig = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_GET_CONFIG_CHANNEL,
  payload: DesktopPreviewConfigInputSchema,
  result: DesktopPreviewWebviewConfigSchema,
  handler: Effect.fn("desktop.ipc.preview.getConfig")(function* ({ environmentId, profileId }) {
    const manager = yield* PreviewManager.PreviewManager;
    const { scope, persistent, namespace } = resolvePartitionScope(environmentId, profileId);
    // Creating the session first is what installs the UA rewrite and permission
    // handlers; a guest that attached to an untouched partition would run with
    // Electron's default UA and Chromium's default permission behaviour.
    yield* manager.getBrowserSession(scope, persistent, namespace);
    return {
      partition: yield* manager.getBrowserPartition(scope, persistent, namespace),
      webPreferences: PREVIEW_WEBVIEW_PREFERENCES,
      preloadUrl: NodeURL.pathToFileURL(`${__dirname}/preview-pick-preload.cjs`).href,
    };
  }),
});

/**
 * Registered separately from `methods`: these carry `BrowserImport` in their
 * context and their own failure type, so they do not unify with the
 * manager-backed handlers the shared loop iterates.
 */
export const listBrowserImportSources = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_IMPORT_SOURCES_CHANNEL,
  payload: Schema.Void,
  result: Schema.Array(BrowserImportSource),
  handler: Effect.fn("desktop.ipc.preview.listBrowserImportSources")(function* () {
    const browserImport = yield* BrowserImport.BrowserImport;
    return yield* browserImport.listSources;
  }),
});

export const importBrowserCookies = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_IMPORT_COOKIES_CHANNEL,
  payload: DesktopPreviewImportCookiesInputSchema,
  result: BrowserImportResult,
  handler: Effect.fn("desktop.ipc.preview.importBrowserCookies")(function* ({
    environmentId,
    ...importInput
  }) {
    const browserImport = yield* BrowserImport.BrowserImport;
    // Derived in main from the same helper the webview config uses, so cookies
    // land in exactly the partition the profile's tabs attach to.
    const { scope, persistent, namespace } = resolvePartitionScope(
      environmentId,
      importInput.targetProfileId,
    );
    if (importInput.targetProfileId === AGENT_BROWSER_PROFILE_ID) {
      return yield* new BrowserImport.BrowserImportFailedError({
        sourceId: importInput.sourceId,
        reason: "agentPartition",
      });
    }
    const result = yield* browserImport.importCookies({
      input: importInput,
      scope,
      persistent,
      ...(namespace === undefined ? {} : { namespace }),
    });
    // Recording lives in the desktop main process, not in client settings.
    // An agent that can edit settings still cannot erase this ledger, and
    // writing it does not approve agent use of the partition.
    if (result.imported > 0) {
      const manager = yield* PreviewManager.PreviewManager;
      const access = yield* AgentImportedCookieAccess.AgentImportedCookieAccess;
      const sourceName =
        BROWSER_IMPORT_SOURCES.find((source) => source.id === importInput.sourceId)?.name ??
        importInput.sourceId;
      yield* access.recordImport({
        partition: yield* manager.getBrowserPartition(scope, persistent, namespace),
        sourceId: importInput.sourceId,
        sourceName,
        profileId: importInput.targetProfileId,
      });
    }
    return result;
  }),
});

export const agentImportedCookieAccess = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_AGENT_COOKIE_ACCESS_CHANNEL,
  payload: DesktopPreviewAgentCookieAccessInputSchema,
  result: DesktopPreviewAgentCookieAccessSchema,
  handler: Effect.fn("desktop.ipc.preview.agentImportedCookieAccess")(function* ({
    tabId,
    environmentId,
    profileId,
  }) {
    const manager = yield* PreviewManager.PreviewManager;
    return yield* manager.agentImportedCookieAccess(tabId, {
      ...(environmentId === undefined ? {} : { environmentId }),
      ...(profileId === undefined ? {} : { profileId }),
    });
  }),
});

/**
 * The main window is the only renderer allowed to grant, deny, or drive the
 * approval prompt. Preview guests share a preload that can call `ipcRenderer`.
 */
const authorizeImportedCookieGrantSender = (event?: DesktopIpc.DesktopIpcInvokeEvent) =>
  Effect.gen(function* () {
    const manager = yield* PreviewManager.PreviewManager;
    if (yield* manager.acceptsImportedCookieGrantSender(event)) return;
    return yield* new PreviewManager.PreviewOperationError({
      operation: "grantAgentImportedCookieAccess",
      cause: new Error("Imported-cookie approval can only be changed from the desktop window."),
    });
  });

/**
 * Granted only from the desktop confirm dialog. Not registered as a server
 * or agent RPC, and not stored in settings the agent can write.
 */
export const grantAgentImportedCookieAccess = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_GRANT_AGENT_COOKIE_ACCESS_CHANNEL,
  payload: DesktopPreviewTabInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.grantAgentImportedCookieAccess")(function* (
    { tabId },
    event,
  ) {
    yield* authorizeImportedCookieGrantSender(event);
    const manager = yield* PreviewManager.PreviewManager;
    yield* manager.grantAgentImportedCookieAccess(tabId);
  }),
});

export const revokeAgentImportedCookieAccess = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_REVOKE_AGENT_COOKIE_ACCESS_CHANNEL,
  payload: DesktopPreviewTabInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.revokeAgentImportedCookieAccess")(function* (
    { tabId },
    event,
  ) {
    yield* authorizeImportedCookieGrantSender(event);
    const manager = yield* PreviewManager.PreviewManager;
    yield* manager.revokeAgentImportedCookieAccess(tabId);
  }),
});

export const beginAgentImportedCookiePrompt = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_BEGIN_AGENT_COOKIE_PROMPT_CHANNEL,
  payload: DesktopPreviewTabInputSchema,
  result: DesktopPreviewAgentCookiePromptSchema,
  handler: Effect.fn("desktop.ipc.preview.beginAgentImportedCookiePrompt")(function* (
    { tabId },
    event,
  ) {
    yield* authorizeImportedCookieGrantSender(event);
    const manager = yield* PreviewManager.PreviewManager;
    return yield* manager.beginAgentImportedCookiePrompt(tabId);
  }),
});

export const finishAgentImportedCookiePrompt = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_FINISH_AGENT_COOKIE_PROMPT_CHANNEL,
  payload: DesktopPreviewTabInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.finishAgentImportedCookiePrompt")(function* (
    { tabId },
    event,
  ) {
    yield* authorizeImportedCookieGrantSender(event);
    const manager = yield* PreviewManager.PreviewManager;
    yield* manager.finishAgentImportedCookiePrompt(tabId);
  }),
});

export const denyAgentImportedCookieAccess = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_DENY_AGENT_COOKIE_ACCESS_CHANNEL,
  payload: DesktopPreviewTabInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.denyAgentImportedCookieAccess")(function* (
    { tabId },
    event,
  ) {
    yield* authorizeImportedCookieGrantSender(event);
    const manager = yield* PreviewManager.PreviewManager;
    yield* manager.denyAgentImportedCookieAccess(tabId);
  }),
});

export const setAnnotationTheme = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_SET_ANNOTATION_THEME_CHANNEL,
  payload: DesktopPreviewAnnotationThemeInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.setAnnotationTheme")(function* ({ theme }) {
    const manager = yield* PreviewManager.PreviewManager;
    yield* manager.setAnnotationTheme(theme);
  }),
});

export const pickElement = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_PICK_ELEMENT_CHANNEL,
  payload: DesktopPreviewTabInputSchema,
  result: Schema.NullOr(PreviewAnnotationSubmissionResultSchema),
  handler: Effect.fn("desktop.ipc.preview.pickElement")(function* ({ tabId }) {
    const manager = yield* PreviewManager.PreviewManager;
    return yield* manager.pickElement(tabId);
  }),
});

export const captureScreenshot = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_CAPTURE_SCREENSHOT_CHANNEL,
  payload: DesktopPreviewTabInputSchema,
  result: DesktopPreviewScreenshotArtifactSchema,
  handler: Effect.fn("desktop.ipc.preview.captureScreenshot")(function* ({ tabId }) {
    const manager = yield* PreviewManager.PreviewManager;
    return yield* manager.captureScreenshot(tabId);
  }),
});

export const revealArtifact = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_REVEAL_ARTIFACT_CHANNEL,
  payload: DesktopPreviewArtifactInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.revealArtifact")(function* ({ path }) {
    const manager = yield* PreviewManager.PreviewManager;
    yield* manager.revealArtifact(path);
  }),
});

export const copyArtifactToClipboard = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_COPY_ARTIFACT_CHANNEL,
  payload: DesktopPreviewArtifactInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.copyArtifactToClipboard")(function* ({ path }) {
    const manager = yield* PreviewManager.PreviewManager;
    yield* manager.copyArtifactToClipboard(path);
  }),
});

export const automationStatus = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_AUTOMATION_STATUS_CHANNEL,
  payload: DesktopPreviewTabInputSchema,
  result: DesktopPreviewAutomationStatusSchema,
  handler: Effect.fn("desktop.ipc.preview.automationStatus")(function* ({ tabId }) {
    const manager = yield* PreviewManager.PreviewManager;
    return yield* manager.automationStatus(tabId);
  }),
});

export const automationSnapshot = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_AUTOMATION_SNAPSHOT_CHANNEL,
  payload: DesktopPreviewTabInputSchema,
  result: PreviewAutomationSnapshot,
  handler: Effect.fn("desktop.ipc.preview.automationSnapshot")(function* ({ tabId }) {
    const manager = yield* PreviewManager.PreviewManager;
    return yield* manager.automationSnapshot(tabId);
  }),
});

export const automationClick = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_AUTOMATION_CLICK_CHANNEL,
  payload: DesktopPreviewAutomationClickInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.automationClick")(function* ({ tabId, input }) {
    const manager = yield* PreviewManager.PreviewManager;
    yield* manager.automationClick(tabId, input);
  }),
});

export const automationType = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_AUTOMATION_TYPE_CHANNEL,
  payload: DesktopPreviewAutomationTypeInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.automationType")(function* ({ tabId, input }) {
    const manager = yield* PreviewManager.PreviewManager;
    yield* manager.automationType(tabId, input);
  }),
});

export const automationPress = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_AUTOMATION_PRESS_CHANNEL,
  payload: DesktopPreviewAutomationPressInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.automationPress")(function* ({ tabId, input }) {
    const manager = yield* PreviewManager.PreviewManager;
    yield* manager.automationPress(tabId, input);
  }),
});

export const automationScroll = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_AUTOMATION_SCROLL_CHANNEL,
  payload: DesktopPreviewAutomationScrollInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.automationScroll")(function* ({ tabId, input }) {
    const manager = yield* PreviewManager.PreviewManager;
    yield* manager.automationScroll(tabId, input);
  }),
});

export const automationEvaluate = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_AUTOMATION_EVALUATE_CHANNEL,
  payload: DesktopPreviewAutomationEvaluateInputSchema,
  result: Schema.Unknown,
  handler: Effect.fn("desktop.ipc.preview.automationEvaluate")(function* ({ tabId, input }) {
    const manager = yield* PreviewManager.PreviewManager;
    return yield* manager.automationEvaluate(tabId, input);
  }),
});

export const automationWaitFor = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_AUTOMATION_WAIT_FOR_CHANNEL,
  payload: DesktopPreviewAutomationWaitForInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.preview.automationWaitFor")(function* ({ tabId, input }) {
    const manager = yield* PreviewManager.PreviewManager;
    yield* manager.automationWaitFor(tabId, input);
  }),
});

export const saveRecording = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREVIEW_RECORDING_SAVE_CHANNEL,
  payload: DesktopPreviewRecordingSaveInputSchema,
  result: DesktopPreviewRecordingArtifactSchema,
  handler: Effect.fn("desktop.ipc.preview.saveRecording")(function* ({ tabId, mimeType, data }) {
    const manager = yield* PreviewManager.PreviewManager;
    return yield* manager.saveRecording(tabId, mimeType, data);
  }),
});

export const methods = [
  createTab,
  closeTab,
  registerWebview,
  navigate,
  goBack,
  goForward,
  refresh,
  zoomIn,
  zoomOut,
  resetZoom,
  hardReload,
  setColorScheme,
  setAudioMuted,
  openDevTools,
  clearCookies,
  clearCache,
  getPreviewConfig,
  agentImportedCookieAccess,
  grantAgentImportedCookieAccess,
  revokeAgentImportedCookieAccess,
  beginAgentImportedCookiePrompt,
  finishAgentImportedCookiePrompt,
  denyAgentImportedCookieAccess,
  setAnnotationTheme,
  pickElement,
  cancelPickElement,
  captureScreenshot,
  revealArtifact,
  copyArtifactToClipboard,
  openPictureInPicture,
  closePictureInPicture,
  automationStatus,
  automationSnapshot,
  automationClick,
  automationType,
  automationPress,
  automationScroll,
  automationEvaluate,
  automationWaitFor,
  startRecording,
  stopRecording,
  saveRecording,
] as const;
