import type { EnvironmentId } from "@e6tools/contracts";
import { useAtomValue } from "@effect/atom-react";

import { localEnvironmentWordAtom, type LocalEnvironmentWord } from "../localEnvironmentWord";
import { usePrimaryEnvironmentId } from "../state/environments";

/**
 * The starting word for `environmentId` when it is the desktop's local environment and that is
 * not ready; `null` for every other environment and state, which keep their connection words.
 */
export function useLocalEnvironmentWord(
  environmentId: EnvironmentId | null,
): LocalEnvironmentWord | null {
  const word = useAtomValue(localEnvironmentWordAtom);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  return environmentId !== null && environmentId === primaryEnvironmentId ? word : null;
}
