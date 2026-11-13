import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@e6tools/contracts";

import { parkedListsAtom, parkedQueueAtom } from "../../state/parked";
import { threadNoteText } from "./parkedListModel";

/**
 * The thread's note to self, kept by the thread's environment, with this
 * phone's unsent edit applied; null when it has none.
 */
export function useThreadNote(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): string | null {
  const lists = useAtomValue(parkedListsAtom);
  const queue = useAtomValue(parkedQueueAtom);
  if (environmentId === null || threadId === null) return null;
  return threadNoteText(lists, queue, environmentId, threadId);
}
