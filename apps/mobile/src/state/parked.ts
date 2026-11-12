/**
 * Parked thoughts on mobile (phase 20). Thoughts live on each environment that
 * advertises `parkedSync`; this phone keeps only its unsent changes, in a file,
 * and sends them in order whenever that environment's list arrives (that is,
 * on every reconnect). See `@e6tools/client-runtime/parked-sync`.
 */
import { enqueueParkedOp, ParkedOp } from "@e6tools/client-runtime/parked-sync";
import type { EnvironmentId, OrchestrationParkedState } from "@e6tools/contracts";
import { createParkedEnvironmentAtoms } from "@e6tools/client-runtime/state/parked";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { writeFileAtomically } from "../lib/atomic-file";
import { appAtomRegistry } from "./atom-registry";
import { environmentServerConfigsAtom } from "./server";

export const parkedEnvironment = createParkedEnvironmentAtoms(connectionAtomRuntime);

const PARKED_QUEUE_FILE = "parked-queue.json";
const decodeQueue = Schema.decodeUnknownSync(Schema.Array(ParkedOp));

/** This phone's changes the server has not answered yet. */
export const parkedQueueAtom = Atom.make<ReadonlyArray<ParkedOp>>([]).pipe(Atom.keepAlive);

async function queueFile() {
  const { File, Paths } = await import("expo-file-system");
  return new File(Paths.document, PARKED_QUEUE_FILE);
}

let queueLoaded: Promise<void> | null = null;

/** Reads the stored queue once; later calls wait for the same read. */
export function loadParkedQueue(): Promise<void> {
  queueLoaded ??= (async () => {
    try {
      const file = await queueFile();
      if (!file.exists) return;
      const stored = decodeQueue(JSON.parse(await file.text()));
      // Anything queued before the read finished stays after what was stored.
      const current = appAtomRegistry.get(parkedQueueAtom);
      appAtomRegistry.set(parkedQueueAtom, [...stored, ...current]);
    } catch (error) {
      console.warn("[parked] could not read the queue", error);
    }
  })();
  return queueLoaded;
}

function persistQueue(ops: ReadonlyArray<ParkedOp>) {
  void queueFile()
    .then((file) => writeFileAtomically(file, JSON.stringify(ops)))
    .catch((error) => console.warn("[parked] could not save the queue", error));
}

export function enqueueParked(op: ParkedOp): void {
  const next = enqueueParkedOp(appAtomRegistry.get(parkedQueueAtom), op);
  appAtomRegistry.set(parkedQueueAtom, next);
  persistQueue(next);
}

/** The server answered (accepted or refused): the change leaves the queue. */
export function settleParked(opId: string): void {
  const next = appAtomRegistry.get(parkedQueueAtom).filter((op) => op.opId !== opId);
  appAtomRegistry.set(parkedQueueAtom, next);
  persistQueue(next);
}

/** Environments that keep a Parked list. Older servers do not, and are left alone. */
export const parkedEnvironmentIdsAtom = Atom.make((get): ReadonlyArray<EnvironmentId> => {
  const ids: EnvironmentId[] = [];
  for (const [environmentId, config] of get(environmentServerConfigsAtom)) {
    if (config.environment.capabilities.parkedSync === true) ids.push(environmentId);
  }
  return ids;
}).pipe(Atom.withLabel("mobile-parked:environments"));

/** Each synced environment's list, once its first snapshot has arrived. */
export const parkedListsAtom = Atom.make(
  (get): ReadonlyMap<EnvironmentId, OrchestrationParkedState> => {
    const lists = new Map<EnvironmentId, OrchestrationParkedState>();
    for (const environmentId of get(parkedEnvironmentIdsAtom)) {
      const result = get(parkedEnvironment.list({ environmentId, input: {} }));
      const value = Option.getOrNull(AsyncResult.value(result));
      if (value) lists.set(environmentId, value);
    }
    return lists;
  },
).pipe(Atom.withLabel("mobile-parked:lists"));
