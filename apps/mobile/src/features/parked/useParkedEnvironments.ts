import { useAtomValue } from "@effect/atom-react";
import { mayParkIn, selectParkedOfferEnvironment } from "@e6tools/client-runtime/parked-sync";
import { useMemo } from "react";

import { useEnvironments } from "../../state/environments";
import {
  parkedConsentsAtom,
  parkedEnvironmentIdsAtom,
  parkedListsAtom,
  parkedQueueAtom,
} from "../../state/parked";
import { buildParkedRows } from "./parkedListModel";

/**
 * Where parked thoughts and notes can go from this phone, for the Parked
 * screen and the sheets that park a thought or write a note: the environments
 * the user accepted saving to, the one to offer next (`preferredEnvironmentId`
 * first, say the thread's), and every accepted thought with this phone's
 * unsent changes applied.
 */
export function useParkedEnvironments(preferredEnvironmentId: string | null = null) {
  const lists = useAtomValue(parkedListsAtom);
  const queue = useAtomValue(parkedQueueAtom);
  const consents = useAtomValue(parkedConsentsAtom);
  const available = useAtomValue(parkedEnvironmentIdsAtom);
  const { environments } = useEnvironments();
  const labelOf = (environmentId: string) =>
    environments.find((environment) => environment.environmentId === environmentId)?.label ??
    "this environment";
  const accepted = Object.keys(consents)
    .filter((environmentId) => mayParkIn(consents, environmentId))
    .map((environmentId) => ({ environmentId, label: labelOf(environmentId) }));
  const acceptedKey = accepted.map((environment) => environment.environmentId).join("\n");
  const rows = useMemo(
    () => buildParkedRows(lists, queue, acceptedKey === "" ? [] : acceptedKey.split("\n")),
    [lists, queue, acceptedKey],
  );
  return {
    lists,
    queue,
    consents,
    available,
    labelOf,
    accepted,
    rows,
    hasEnvironments: environments.length > 0,
    offer: selectParkedOfferEnvironment({
      consents,
      available,
      primaryEnvironmentId: preferredEnvironmentId,
    }),
    declinedAvailable: available.filter((id) => consents[id] === "declined"),
  };
}
