import { useAtomValue } from "@effect/atom-react";
import { isParkedOpRefused, parkedOpCommand } from "@e6tools/client-runtime/parked-sync";
import { squashAtomCommandFailure } from "@e6tools/client-runtime/state/runtime";
import { EnvironmentId } from "@e6tools/contracts";
import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";

import {
  loadParkedQueue,
  parkedEnvironment,
  parkedListsAtom,
  parkedQueueAtom,
  settleParked,
} from "../../state/parked";
import { useAtomCommand } from "../../state/use-atom-command";

/**
 * Sends this phone's queued Parked changes, one at a time, to environments
 * whose list has arrived. A change the server refuses is dropped (its list is
 * the one every device agrees on), and a refused thought is shown back; one that could not be sent waits for the
 * next time the list arrives. Renders nothing.
 */
export function ParkedQueueWorker() {
  const lists = useAtomValue(parkedListsAtom);
  const queue = useAtomValue(parkedQueueAtom);
  const dispatch = useAtomCommand(parkedEnvironment.dispatch, { reportFailure: false });
  const sending = useRef(false);
  const [settled, setSettled] = useState(0);

  useEffect(() => {
    void loadParkedQueue();
  }, []);

  useEffect(() => {
    if (sending.current) return;
    const op = queue.find((candidate) =>
      [...lists.keys()].some((environmentId) => environmentId === candidate.environmentId),
    );
    if (!op) return;
    sending.current = true;
    void (async () => {
      let progressed = false;
      try {
        const result = await dispatch({
          environmentId: EnvironmentId.make(op.environmentId),
          input: parkedOpCommand(op),
        });
        const refused =
          result._tag === "Failure" && isParkedOpRefused(squashAtomCommandFailure(result));
        if (result._tag === "Success" || refused) {
          settleParked(op.opId);
          progressed = true;
        }
        // A thought the server would not take is shown back, never dropped unseen.
        if (refused && op.kind === "add") {
          Alert.alert(
            "Could not park this thought",
            `${op.text}\n\nParked is full. Remove one to add another.`,
          );
        }
      } finally {
        sending.current = false;
        if (progressed) setSettled((count) => count + 1);
      }
    })();
  }, [dispatch, lists, queue, settled]);

  return null;
}
