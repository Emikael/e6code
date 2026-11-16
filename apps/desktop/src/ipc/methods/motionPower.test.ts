import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import * as ElectronPowerMonitor from "../../electron/ElectronPowerMonitor.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import { MOTION_POWER_STATE_CHANNEL } from "../channels.ts";
import { getMotionPowerState, installMotionPowerStateForwarding } from "./motionPower.ts";

const makePowerMonitor = (initial: {
  onBattery: boolean;
  thermal: ElectronPowerMonitor.ElectronThermalState;
}) => {
  const simple = new Map<string, () => void>();
  let thermalListener: ((state: ElectronPowerMonitor.ElectronThermalState) => void) | null = null;
  const layer = Layer.mock(ElectronPowerMonitor.ElectronPowerMonitor)({
    isOnBatteryPower: Effect.sync(() => initial.onBattery),
    getCurrentThermalState: Effect.sync(() => initial.thermal),
    onSimpleEvent: (eventName, listener) =>
      Effect.acquireRelease(
        Effect.sync(() => void simple.set(eventName, listener)),
        () => Effect.sync(() => void simple.delete(eventName)),
      ),
    onThermalStateChange: (listener) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          thermalListener = listener;
        }),
        () =>
          Effect.sync(() => {
            thermalListener = null;
          }),
      ),
  });
  return {
    layer,
    emit: (eventName: "on-battery" | "on-ac") => simple.get(eventName)?.(),
    emitThermal: (state: ElectronPowerMonitor.ElectronThermalState) => thermalListener?.(state),
    listenerCount: () => simple.size + (thermalListener === null ? 0 : 1),
  };
};

const makeWindows = () => {
  const sent: Array<[string, ...ReadonlyArray<unknown>]> = [];
  const layer = Layer.mock(ElectronWindow.ElectronWindow)({
    sendAll: (channel, ...args) => Effect.sync(() => void sent.push([channel, ...args])),
  });
  return { layer, sent };
};

describe("getMotionPowerState", () => {
  it.effect("reads battery and thermal state from the power monitor", () => {
    const power = makePowerMonitor({ onBattery: true, thermal: "serious" });
    return Effect.gen(function* () {
      assert.deepEqual(yield* getMotionPowerState.handler(), {
        onBattery: true,
        thermalState: "serious",
      });
    }).pipe(Effect.provide(power.layer));
  });
});

describe("installMotionPowerStateForwarding", () => {
  it.effect("pushes each change to every window and stops when its scope closes", () => {
    const power = makePowerMonitor({ onBattery: false, thermal: "nominal" });
    const windows = makeWindows();
    return Effect.gen(function* () {
      const scope = yield* Scope.make();
      yield* installMotionPowerStateForwarding().pipe(Scope.provide(scope));

      power.emit("on-ac"); // Already on mains: nothing changed, nothing sent.
      power.emit("on-battery");
      power.emitThermal("critical");
      power.emitThermal("critical");
      power.emit("on-ac");

      assert.deepEqual(windows.sent, [
        [MOTION_POWER_STATE_CHANNEL, { onBattery: true, thermalState: "nominal" }],
        [MOTION_POWER_STATE_CHANNEL, { onBattery: true, thermalState: "critical" }],
        [MOTION_POWER_STATE_CHANNEL, { onBattery: false, thermalState: "critical" }],
      ]);

      yield* Scope.close(scope, Exit.void);
      assert.equal(power.listenerCount(), 0);
    }).pipe(Effect.provide(Layer.merge(power.layer, windows.layer)));
  });
});
