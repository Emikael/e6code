import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { startupClock } from "../../app/DesktopStartupClock.ts";
import { applyRendererStartupMark } from "../../app/DesktopStartupRecord.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import { STARTUP_MARK_CHANNEL } from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

/** A paint entry or `e6:startup:` mark, as the preload forwards it. */
const StartupMarkPayload = Schema.Struct({
  name: Schema.String,
  epochMs: Schema.Finite,
});

/** Only the main window's renderer describes this launch's startup. */
export const reportStartupMark = DesktopIpc.makeIpcMethod({
  channel: STARTUP_MARK_CHANNEL,
  payload: StartupMarkPayload,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.startupMarks.report")(function* (mark, event) {
    const mainWindow = yield* ElectronWindow.ElectronWindow.pipe(
      Effect.flatMap((electronWindow) => electronWindow.main),
    );
    const fromMainWindow = Option.exists(
      mainWindow,
      (window) => !window.isDestroyed() && window.webContents.id === event?.sender.id,
    );
    if (fromMainWindow) applyRendererStartupMark(startupClock, mark);
  }),
});
