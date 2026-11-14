/**
 * Parked thoughts on mobile (phase 20). Thoughts live on an environment that
 * advertises `parkedSync` and that the user accepted saving to (asked once per
 * environment, kept in a file); nothing is sent to any other. This phone keeps
 * only its unsent changes, in a file, and sends them in order whenever that
 * environment's list arrives (that is, on every reconnect). See
 * `@e6tools/client-runtime/parked-sync`.
 */
import {
  enqueueParkedOp,
  mayParkIn,
  ParkedConsents,
  ParkedOp,
  type ParkedConsent,
} from "@e6tools/client-runtime/parked-sync";
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
const PARKED_CONSENT_FILE = "parked-consent.json";
const decodeQueue = Schema.decodeUnknownSync(Schema.Array(ParkedOp));
const decodeConsents = Schema.decodeUnknownSync(ParkedConsents);

/** This phone's changes the server has not answered yet. */
export const parkedQueueAtom = Atom.make<ReadonlyArray<ParkedOp>>([]).pipe(Atom.keepAlive);

/** The user's answer per environment to saving parked thoughts there. */
export const parkedConsentsAtom = Atom.make<ParkedConsents>({}).pipe(Atom.keepAlive);

async function documentFile(name: string) {
  const { File, Paths } = await import("expo-file-system");
  return new File(Paths.document, name);
}

const queueFile = () => documentFile(PARKED_QUEUE_FILE);

let queueLoaded: Promise<void> | null = null;

/** Reads the stored queue and answers once; later calls wait for the same read. */
export function loadParkedQueue(): Promise<void> {
  queueLoaded ??= (async () => {
    try {
      const file = await documentFile(PARKED_CONSENT_FILE);
      if (file.exists) {
        const stored = decodeConsents(JSON.parse(await file.text()));
        // An answer given before the read finished wins.
        appAtomRegistry.set(parkedConsentsAtom, {
          ...stored,
          ...appAtomRegistry.get(parkedConsentsAtom),
        });
      }
    } catch (error) {
      console.warn("[parked] could not read the saving choices", error);
    }
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

/** Records the user's answer for an environment; until "accepted" nothing goes there. */
export function setParkedConsent(environmentId: string, consent: ParkedConsent): void {
  const next = { ...appAtomRegistry.get(parkedConsentsAtom), [environmentId]: consent };
  appAtomRegistry.set(parkedConsentsAtom, next);
  void documentFile(PARKED_CONSENT_FILE)
    .then((file) => writeFileAtomically(file, JSON.stringify(next)))
    .catch((error) => console.warn("[parked] could not save the saving choice", error));
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

/**
 * Each accepted environment's list, once its first snapshot has arrived. An
 * environment the user has not accepted is not even read.
 */
export const parkedListsAtom = Atom.make(
  (get): ReadonlyMap<EnvironmentId, OrchestrationParkedState> => {
    const lists = new Map<EnvironmentId, OrchestrationParkedState>();
    const consents = get(parkedConsentsAtom);
    for (const environmentId of get(parkedEnvironmentIdsAtom)) {
      if (!mayParkIn(consents, environmentId)) continue;
      const result = get(parkedEnvironment.list({ environmentId, input: {} }));
      const value = Option.getOrNull(AsyncResult.value(result));
      if (value) lists.set(environmentId, value);
    }
    return lists;
  },
).pipe(Atom.withLabel("mobile-parked:lists"));
