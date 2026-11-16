import { DesktopMotionPowerStateSchema, type DesktopMotionPowerState } from "@e6tools/contracts";
import * as Effect from "effect/Effect";

import * as ElectronPowerMonitor from "../../electron/ElectronPowerMonitor.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import { GET_MOTION_POWER_STATE_CHANNEL, MOTION_POWER_STATE_CHANNEL } from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const readMotionPowerState = Effect.gen(function* () {
  const powerMonitor = yield* ElectronPowerMonitor.ElectronPowerMonitor;
  return {
    onBattery: yield* powerMonitor.isOnBatteryPower,
    thermalState: yield* powerMonitor.getCurrentThermalState,
  } satisfies DesktopMotionPowerState;
});

/** The renderer reads this once, synchronously, so its first frame has a motion level. */
export const getMotionPowerState = DesktopIpc.makeSyncIpcMethod({
  channel: GET_MOTION_POWER_STATE_CHANNEL,
  result: DesktopMotionPowerStateSchema,
  handler: Effect.fn("desktop.ipc.motionPower.get")(function* () {
    return yield* readMotionPowerState;
  }),
});

/**
 * Pushes battery and thermal changes to every window, only when the state changes. The state
 * follows the events rather than re-reading the monitor, which can lag an `on-battery` event.
 */
export const installMotionPowerStateForwarding = Effect.fn(
  "desktop.ipc.installMotionPowerStateForwarding",
)(function* () {
  const powerMonitor = yield* ElectronPowerMonitor.ElectronPowerMonitor;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  let state = yield* readMotionPowerState;

  const update = (next: Partial<DesktopMotionPowerState>) => {
    const merged = { ...state, ...next };
    if (merged.onBattery === state.onBattery && merged.thermalState === state.thermalState) return;
    state = merged;
    Effect.runSync(electronWindow.sendAll(MOTION_POWER_STATE_CHANNEL, state));
  };

  yield* powerMonitor.onSimpleEvent("on-battery", () => update({ onBattery: true }));
  yield* powerMonitor.onSimpleEvent("on-ac", () => update({ onBattery: false }));
  yield* powerMonitor.onThermalStateChange((thermalState) => update({ thermalState }));
});
