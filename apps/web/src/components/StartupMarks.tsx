import { enabledEnvironmentIds } from "@e6tools/client-runtime/state/connections";
import {
  resolveStartupShellSource,
  startupLandingMark,
  startupShellInteractiveMark,
  type StartupLanding,
} from "@e6tools/shared/startupMarks";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect } from "react";

import { environmentCatalog } from "../connection/catalog";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useAllEnvironmentShellsBootstrapped } from "../state/entities";
import { environmentShell } from "../state/shell";

// Both marks describe this page load, so each is set at most once per document.
let landingMarked = false;
let shellInteractiveScheduled = false;

/** Marks the root surface this page load landed on; the first one rendered wins. */
export function StartupLandingMark({ landing }: { readonly landing: StartupLanding }) {
  useEffect(() => {
    if (landingMarked) return;
    landingMarked = true;
    performance.mark(startupLandingMark(landing));
  }, [landing]);
  return null;
}

/** Marks the first frame after every enabled environment's shell has something to show. */
export function StartupShellInteractiveMark() {
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  useEffect(() => {
    if (!bootstrapped || shellInteractiveScheduled) return;
    shellInteractiveScheduled = true;
    requestAnimationFrame(() => {
      setTimeout(() => performance.mark(startupShellInteractiveMark(readShellSource())), 0);
    });
  }, [bootstrapped]);
  return null;
}

function readShellSource() {
  const catalog = AsyncResult.value(appAtomRegistry.get(environmentCatalog.catalogAtom));
  if (Option.isNone(catalog)) return resolveStartupShellSource([]);
  return resolveStartupShellSource(
    Array.from(enabledEnvironmentIds(catalog.value), (environmentId) => {
      const shell = appAtomRegistry.get(environmentShell.stateValueAtom(environmentId));
      return { hasSnapshot: Option.isSome(shell.snapshot), live: shell.status === "live" };
    }),
  );
}
