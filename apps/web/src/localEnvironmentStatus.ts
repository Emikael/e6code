import type { DesktopBridge, DesktopLocalEnvironmentStatus } from "@e6tools/contracts";
import { Atom } from "effect/unstable/reactivity";

/**
 * The desktop's local environment lifecycle. `undefined` when there is no desktop bridge, or
 * the desktop predates the status (browsers on every connection mode, older shells): those
 * keep today's gate. `null` when the desktop's local environment is disabled.
 */
export function readLocalEnvironmentStatus(
  bridge: Pick<DesktopBridge, "getLocalEnvironmentStatus"> | undefined,
): DesktopLocalEnvironmentStatus | null | undefined {
  return bridge?.getLocalEnvironmentStatus?.();
}

/** Follows status pushes from the desktop; `undefined` where there is no status to follow. */
export const localEnvironmentStatusAtom = Atom.make(
  (get): DesktopLocalEnvironmentStatus | null | undefined => {
    const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
    const stop = bridge?.onLocalEnvironmentStatus?.((status) => get.setSelf(status));
    if (stop !== undefined) get.addFinalizer(stop);
    return readLocalEnvironmentStatus(bridge);
  },
).pipe(Atom.keepAlive, Atom.withLabel("web-local-environment-status"));

export type RootGateMode = "local-starting" | "server";

/**
 * Whether the root route can authenticate against the primary now, or must show the app from
 * cache while the desktop's local environment starts. Only the desktop's own status decides
 * (a failed request never does), so every browser keeps today's gate. A pairing token in the
 * URL is always exchanged, and a renderer that has authenticated once keeps its gate through
 * later backend restarts instead of unmounting the coordinators that depend on it.
 */
export function resolveRootGateMode(input: {
  readonly localEnvironmentStatus: DesktopLocalEnvironmentStatus | null | undefined;
  readonly hasPairingToken: boolean;
  readonly authenticatedThisSession: boolean;
}): RootGateMode {
  const status = input.localEnvironmentStatus;
  if (status === undefined || status === null) return "server";
  if (input.hasPairingToken || input.authenticatedThisSession) return "server";
  return status.state === "ready" ? "server" : "local-starting";
}

/**
 * Route guards admit the app when the primary is authenticated, when there is no primary to
 * authenticate (hosted or local environment disabled), and while the desktop's local
 * environment is still starting; anything else belongs on `/pair`.
 */
export function canEnterApp<State extends { readonly status: string }>(
  authGateState: State,
): authGateState is Extract<State, { readonly status: AppEntryStatus }> {
  return APP_ENTRY_STATUSES.has(authGateState.status);
}

type AppEntryStatus = "authenticated" | "hosted-static" | "local-starting";
const APP_ENTRY_STATUSES: ReadonlySet<string> = new Set<AppEntryStatus>([
  "authenticated",
  "hosted-static",
  "local-starting",
]);
