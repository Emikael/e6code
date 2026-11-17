import { useAtomValue } from "@effect/atom-react";
import { enabledEnvironmentIds } from "@e6tools/client-runtime/state/connections";
import {
  resolveStartupShellSyncStatus,
  startupLandingMark,
  startupShellInteractiveMark,
  type StartupLanding,
} from "@e6tools/shared/startupMarks";
import * as Option from "effect/Option";
import { Atom } from "effect/unstable/reactivity";
import { useEffect, useState } from "react";

import { environmentCatalog } from "../connection/catalog";
import { allEnvironmentShellsBootstrappedAtom, environmentShell } from "../state/shell";

// Both marks describe this page load, so each is set at most once per document.
let landingMarked = false;
let shellInteractiveScheduled = false;

/**
 * The shell's sync status once every enabled environment is bootstrapped and at least one
 * has a snapshot to show; `null` until then. Bootstrapped alone is not enough: it can hold
 * for a moment before any environment's snapshot, cached or live, is readable.
 */
const startupShellSyncStatusAtom = Atom.make((get) => {
  if (!get(allEnvironmentShellsBootstrappedAtom)) return null;
  return resolveStartupShellSyncStatus(
    Array.from(enabledEnvironmentIds(get(environmentCatalog.catalogValueAtom)), (environmentId) => {
      const shell = get(environmentShell.stateValueAtom(environmentId));
      return { hasSnapshot: Option.isSome(shell.snapshot), status: shell.status };
    }),
  );
}).pipe(Atom.withLabel("web-startup-shell-sync-status"));

/** Marks the root surface this page load landed on; the first one rendered wins. */
export function StartupLandingMark({ landing }: { readonly landing: StartupLanding }) {
  useEffect(() => {
    if (landingMarked) return;
    landingMarked = true;
    performance.mark(startupLandingMark(landing));
  }, [landing]);
  return null;
}

/**
 * Marks the first frame in which the shell has data to show. The watcher follows shell state
 * only until then, so streaming updates afterwards cost it nothing.
 */
export function StartupShellInteractiveMark() {
  const [watching, setWatching] = useState(() => !shellInteractiveScheduled);
  return watching ? <ShellInteractiveWatcher onScheduled={() => setWatching(false)} /> : null;
}

function ShellInteractiveWatcher({ onScheduled }: { readonly onScheduled: () => void }) {
  const syncStatus = useAtomValue(startupShellSyncStatusAtom);
  useEffect(() => {
    if (syncStatus === null) return;
    if (!shellInteractiveScheduled) {
      shellInteractiveScheduled = true;
      requestAnimationFrame(() => {
        setTimeout(() => performance.mark(startupShellInteractiveMark(syncStatus)), 0);
      });
    }
    onScheduled();
  }, [syncStatus, onScheduled]);
  return null;
}
