import {
  EMPTY_PARKED_STATE,
  ORCHESTRATION_WS_METHODS,
  reduceParkedStream,
  type OrchestrationParkedState,
} from "@e6tools/contracts";
import * as Stream from "effect/Stream";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/**
 * An environment's Parked list (`parked.ts` in contracts). Subscribe only to
 * environments that advertise `parkedSync`; older servers reject the method.
 */
export function createParkedEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const commandScheduler = createAtomCommandScheduler();
  return {
    /** The list as the server holds it, after the first snapshot arrives. */
    list: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:parked:list",
      tag: ORCHESTRATION_WS_METHODS.subscribeParked,
      transform: (stream) =>
        stream.pipe(
          Stream.scan(EMPTY_PARKED_STATE as OrchestrationParkedState, reduceParkedStream),
          // `scan` first emits its seed; the list is known only after the snapshot.
          Stream.drop(1),
        ),
    }),
    /** Sends one queued change. Serial per environment so changes land in order. */
    dispatch: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:parked:dispatch",
      tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
      scheduler: commandScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId }) => environmentId,
      },
    }),
  };
}
