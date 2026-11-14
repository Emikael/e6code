/**
 * Keeps this browser's Parked list in step with each environment the user
 * accepted saving to (phase 20). Renders nothing.
 *
 * It tells the store which connected environments can hold a list, so the
 * Parked list can offer saving there; nothing is sent to an environment until
 * the user accepts. For every accepted environment it follows the
 * environment's list, uploads once whatever thoughts and notes this browser
 * kept for it (the server keeps one copy however often they arrive), and
 * sends this device's queued changes in order. A change that cannot be sent
 * waits in storage; it goes out the next time that environment's list
 * arrives, which happens on every reconnect.
 */
import { useAtomValue } from "@effect/atom-react";
import { CommandId, type EnvironmentId } from "@e6tools/contracts";
import {
  isParkedOpRefused,
  mayParkIn,
  parkedOpCommand,
  parkedOpProblem,
} from "@e6tools/client-runtime/parked-sync";
import { squashAtomCommandFailure } from "@e6tools/client-runtime/state/runtime";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useRef, useState } from "react";

import { selectNextParkedSend, usePromptStashStore, type ParkedNotice } from "../promptStashStore";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useServerConfigs } from "../state/entities";
import { parkedEnvironment } from "../state/parked";
import { useAtomCommand } from "../state/use-atom-command";
import { randomUUID } from "../lib/utils";
import { toastManager } from "./ui/toast";

export function ParkedSyncCoordinator() {
  const serverConfigs = useServerConfigs();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const consents = usePromptStashStore((store) => store.consents);
  useEffect(() => {
    usePromptStashStore.getState().setPrimaryEnvironmentId(primaryEnvironmentId);
  }, [primaryEnvironmentId]);
  const available: EnvironmentId[] = [];
  for (const [environmentId, config] of serverConfigs) {
    if (config.environment.capabilities.parkedSync === true) available.push(environmentId);
  }
  const availableKey = available.join("\n");
  useEffect(() => {
    usePromptStashStore
      .getState()
      .setAvailableEnvironmentIds(availableKey === "" ? [] : availableKey.split("\n"));
  }, [availableKey]);
  return available
    .filter((environmentId) => mayParkIn(consents, environmentId))
    .map((environmentId) => (
      <ParkedEnvironmentSync key={environmentId} environmentId={environmentId} />
    ));
}

function showNotice(notice: ParkedNotice | null) {
  if (notice) toastManager.add({ ...notice });
}

function ParkedEnvironmentSync({ environmentId }: { environmentId: EnvironmentId }) {
  const list = useAtomValue(parkedEnvironment.list({ environmentId, input: {} }));
  const listValue = Option.getOrNull(AsyncResult.value(list));
  const dispatch = useAtomCommand(parkedEnvironment.dispatch, { reportFailure: false });
  const stored = usePromptStashStore((store) => store.stored);
  const primaryEnvironmentId = usePromptStashStore((store) => store.primaryEnvironmentId);
  const sending = useRef(false);
  // Bumped after a send settles, so the next queued change goes out at once.
  const [settled, setSettled] = useState(0);
  // Uploads answered this session; the list that comes back shows what was kept.
  const uploadedIds = useRef(new Set<string>());

  useEffect(() => {
    if (listValue) usePromptStashStore.getState().receiveParkedList(environmentId, listValue);
  }, [environmentId, listValue]);

  // Only once the list has arrived: before that the environment is not reachable.
  const connected = listValue !== null;
  useEffect(() => {
    if (!connected || sending.current) return;
    const store = usePromptStashStore.getState();
    const next = selectNextParkedSend(store, environmentId, uploadedIds.current);
    if (!next) return;
    sending.current = true;
    void (async () => {
      let progressed = false;
      try {
        if (next.kind === "import") {
          const ids = next.entries.map((entry) => entry.id);
          // Bound to this environment before it leaves, so no other one ever gets it.
          store.markParkedUpload(environmentId, ids, "sending");
          const result = await dispatch({
            environmentId,
            input: {
              type: "parked.import",
              commandId: CommandId.make(randomUUID()),
              entries: next.entries,
              createdAt: new Date().toISOString(),
            },
          });
          const refused =
            result._tag === "Failure" && isParkedOpRefused(squashAtomCommandFailure(result));
          // Answered: not again this session. Anything the server did not keep stays here.
          if (result._tag === "Success" || refused) {
            for (const id of ids) uploadedIds.current.add(id);
            usePromptStashStore.getState().markParkedUpload(environmentId, ids, "answered");
            progressed = true;
          }
          if (refused) {
            showNotice({
              type: "warning",
              title: "Could not save your parked thoughts",
              description: "They are kept in this browser.",
            });
          }
          return;
        }
        const { op } = next;
        // A change that can never be sent must not hold up the ones behind it.
        const problem = parkedOpProblem(op);
        if (problem !== null) {
          showNotice(usePromptStashStore.getState().settleParkedOp(op.opId, "refused", problem));
          progressed = true;
          return;
        }
        const result = await dispatch({ environmentId, input: parkedOpCommand(op) });
        if (result._tag === "Success") {
          showNotice(usePromptStashStore.getState().settleParkedOp(op.opId, "accepted"));
          progressed = true;
        } else if (isParkedOpRefused(squashAtomCommandFailure(result))) {
          showNotice(usePromptStashStore.getState().settleParkedOp(op.opId, "refused"));
          progressed = true;
        }
        // Anything else is the connection: the change waits for the next list.
      } finally {
        sending.current = false;
        if (progressed) setSettled((count) => count + 1);
      }
    })();
  }, [connected, dispatch, environmentId, primaryEnvironmentId, stored, settled]);

  return null;
}
