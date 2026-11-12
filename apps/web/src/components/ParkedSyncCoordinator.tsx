/**
 * Keeps this browser's Parked list in step with each environment that holds
 * one (phase 20). Renders nothing.
 *
 * For every connected environment advertising `parkedSync` it follows the
 * environment's list, uploads once whatever thoughts and notes this origin
 * kept before (the server keeps one copy however often they arrive), and sends
 * this device's queued changes in order. A change that cannot be sent waits
 * in storage; it goes out the next time that environment's list arrives, which
 * happens on every reconnect. Environments without `parkedSync` are left
 * alone, so their thoughts stay on this device as before.
 */
import { useAtomValue } from "@effect/atom-react";
import { CommandId, type EnvironmentId } from "@e6tools/contracts";
import { parkedOpCommand, isParkedOpRefused } from "@e6tools/client-runtime/parked-sync";
import { squashAtomCommandFailure } from "@e6tools/client-runtime/state/runtime";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useRef, useState } from "react";

import { selectParkedImport, usePromptStashStore } from "../promptStashStore";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useServerConfigs } from "../state/entities";
import { parkedEnvironment } from "../state/parked";
import { useAtomCommand } from "../state/use-atom-command";
import { randomUUID } from "../lib/utils";

export function ParkedSyncCoordinator() {
  const serverConfigs = useServerConfigs();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  useEffect(() => {
    usePromptStashStore.getState().setPrimaryEnvironmentId(primaryEnvironmentId);
  }, [primaryEnvironmentId]);
  const synced: EnvironmentId[] = [];
  for (const [environmentId, config] of serverConfigs) {
    if (config.environment.capabilities.parkedSync === true) synced.push(environmentId);
  }
  return synced.map((environmentId) => (
    <ParkedEnvironmentSync key={environmentId} environmentId={environmentId} />
  ));
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
  const uploadedIds = useRef(new Set<string>());

  useEffect(() => {
    if (listValue) usePromptStashStore.getState().receiveParkedList(environmentId, listValue);
  }, [environmentId, listValue]);

  // Only once the list has arrived: before that the environment is not reachable.
  const connected = listValue !== null;
  useEffect(() => {
    if (!connected || sending.current) return;
    const upload = selectParkedImport(stored, environmentId, primaryEnvironmentId).filter(
      (entry) => !uploadedIds.current.has(entry.id),
    );
    const op = stored.parkedOps.find((candidate) => candidate.environmentId === environmentId);
    if (upload.length === 0 && !op) return;
    sending.current = true;
    void (async () => {
      let progressed = false;
      try {
        if (upload.length > 0) {
          const result = await dispatch({
            environmentId,
            input: {
              type: "parked.import",
              commandId: CommandId.make(randomUUID()),
              entries: upload,
              createdAt: new Date().toISOString(),
            },
          });
          // Sent or refused, not again this session: the list that comes back
          // shows what the server kept, and anything it did not keep stays here.
          if (result._tag === "Success" || isParkedOpRefused(squashAtomCommandFailure(result))) {
            for (const entry of upload) uploadedIds.current.add(entry.id);
            progressed = true;
          }
          return;
        }
        if (!op) return;
        const result = await dispatch({ environmentId, input: parkedOpCommand(op) });
        if (result._tag === "Success") {
          usePromptStashStore.getState().settleParkedOp(op.opId, "accepted");
          progressed = true;
        } else if (isParkedOpRefused(squashAtomCommandFailure(result))) {
          usePromptStashStore.getState().settleParkedOp(op.opId, "refused");
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
