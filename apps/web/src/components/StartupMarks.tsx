import { useAtomValue } from "@effect/atom-react";
import { enabledEnvironmentIds } from "@e6tools/client-runtime/state/connections";
import {
  resolveStartupShellSnapshotSource,
  resolveStartupShellSyncStatus,
  startupLandingMark,
  startupShellInteractiveMark,
  startupShellLiveMark,
  type StartupLanding,
} from "@e6tools/shared/startupMarks";
import * as Option from "effect/Option";
import { Atom } from "effect/unstable/reactivity";
import { useEffect, useState } from "react";

import { environmentCatalog } from "../connection/catalog";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { allEnvironmentShellsBootstrappedAtom, environmentShell } from "../state/shell";

// Every mark describes this page load, so each is set at most once per document. The
// starting panel's landing is provisional: the surface that replaces it marks its own.
let landingMarked = false;
let startingLandingMarked = false;
let shellInteractiveScheduled = false;
let shellLiveScheduled = false;

/**
 * The shell's sync status once every enabled environment is bootstrapped and at least one
 * has a snapshot to show; `null` until then. Bootstrapped alone is not enough: it can hold
 * for a moment before any environment's snapshot, cached or live, is readable.
 */
const startupShellsAtom = Atom.make((get) => {
  if (!get(allEnvironmentShellsBootstrappedAtom)) return null;
  return Array.from(enabledEnvironmentIds(get(environmentCatalog.catalogValueAtom)), (id) => {
    const shell = get(environmentShell.stateValueAtom(id));
    return {
      hasSnapshot: Option.isSome(shell.snapshot),
      status: shell.status,
      snapshotSource: shell.snapshotSource,
    };
  });
}).pipe(Atom.withLabel("web-startup-shells"));

const startupShellSyncStatusAtom = Atom.make((get) => {
  const shells = get(startupShellsAtom);
  return shells === null ? null : resolveStartupShellSyncStatus(shells);
}).pipe(Atom.withLabel("web-startup-shell-sync-status"));

/** Where the snapshots on screen came from; `null` until one shows. */
const startupShellSnapshotSourceAtom = Atom.make((get) => {
  const shells = get(startupShellsAtom);
  return shells === null ? null : resolveStartupShellSnapshotSource(shells);
}).pipe(Atom.withLabel("web-startup-shell-snapshot-source"));

/** Whether the primary environment's shell is live; `false` without a primary. */
const startupPrimaryShellLiveAtom = Atom.make((get) => {
  const primaryEnvironmentId = get(primaryEnvironmentIdAtom);
  return (
    primaryEnvironmentId !== null &&
    get(environmentShell.stateValueAtom(primaryEnvironmentId)).status === "live"
  );
}).pipe(Atom.withLabel("web-startup-primary-shell-live"));

/** Marks the root surface this page load landed on; the first one rendered wins. */
export function StartupLandingMark({ landing }: { readonly landing: StartupLanding }) {
  useEffect(() => {
    if (landing === "starting") {
      if (landingMarked || startingLandingMarked) return;
      startingLandingMarked = true;
    } else {
      if (landingMarked) return;
      landingMarked = true;
    }
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
  const source = useAtomValue(startupShellSnapshotSourceAtom);
  useEffect(() => {
    if (syncStatus === null || source === null) return;
    if (!shellInteractiveScheduled) {
      shellInteractiveScheduled = true;
      markAfterNextFrame(startupShellInteractiveMark(syncStatus, source));
    }
    onScheduled();
  }, [syncStatus, source, onScheduled]);
  return null;
}

/**
 * Marks the first frame in which the primary environment's shell is live: with the backend
 * ready, how long the renderer takes to catch up. Without a primary it never marks.
 */
export function StartupShellLiveMark() {
  const [watching, setWatching] = useState(() => !shellLiveScheduled);
  return watching ? <ShellLiveWatcher onScheduled={() => setWatching(false)} /> : null;
}

function ShellLiveWatcher({ onScheduled }: { readonly onScheduled: () => void }) {
  const live = useAtomValue(startupPrimaryShellLiveAtom);
  useEffect(() => {
    if (!live) return;
    if (!shellLiveScheduled) {
      shellLiveScheduled = true;
      markAfterNextFrame(startupShellLiveMark());
    }
    onScheduled();
  }, [live, onScheduled]);
  return null;
}

/** Stamps once the frame that shows the change has been produced. */
function markAfterNextFrame(name: string) {
  requestAnimationFrame(() => {
    setTimeout(() => performance.mark(name), 0);
  });
}
