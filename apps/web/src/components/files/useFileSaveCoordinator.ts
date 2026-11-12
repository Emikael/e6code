import type { EnvironmentId } from "@e6tools/contracts";
import { createRef, useEffect, useMemo } from "react";

import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";

import { FileSaveCoordinator } from "./fileSaveCoordinator";
import { confirmProjectFileQueryData } from "./projectFilesQueryState";

const FILE_SAVE_DEBOUNCE_MS = 500;

interface FileSaveOptions {
  environmentId: EnvironmentId;
  cwd: string;
  /** Null while no editable file is open: changes are then ignored. */
  relativePath: string | null;
  onPendingChange: (relativePath: string, pending: boolean) => void;
  /** A save landed with these contents. */
  onConfirmed?: ((contents: string) => void) | undefined;
  /** See FileSaveCoordinatorOptions.check. */
  check?: ((contents: string) => Promise<boolean>) | undefined;
}

export function useFileSaveCoordinator({
  environmentId,
  cwd,
  relativePath,
  onPendingChange,
  onConfirmed,
  check,
}: FileSaveOptions): Pick<FileSaveCoordinator, "change" | "release" | "discard"> {
  const writeFile = useAtomCommand(projectEnvironment.writeFile);
  const session = useMemo(() => {
    const coordinatorRef = createRef<FileSaveCoordinator>();
    return {
      change: (contents: string) => coordinatorRef.current?.change(contents),
      release: (contents?: string) => coordinatorRef.current?.release(contents),
      discard: () => coordinatorRef.current?.discard() ?? false,
      setup: () => {
        if (relativePath === null) return;
        const coordinator = new FileSaveCoordinator({
          debounceMs: FILE_SAVE_DEBOUNCE_MS,
          onPendingChange: (pending) => onPendingChange(relativePath, pending),
          persist: (nextContents) =>
            writeFile({
              environmentId,
              input: { cwd, relativePath, contents: nextContents },
            }),
          onConfirmed: (confirmedContents) => {
            confirmProjectFileQueryData(environmentId, cwd, relativePath, confirmedContents);
            onConfirmed?.(confirmedContents);
          },
          check,
        });
        coordinatorRef.current = coordinator;
        return () => {
          coordinatorRef.current = null;
          coordinator.dispose();
        };
      },
    };
  }, [check, cwd, environmentId, onConfirmed, onPendingChange, relativePath, writeFile]);

  // StrictMode replays effect setup. Retired file sessions stay inert, while the
  // replay gets a fresh coordinator instead of reusing a disposed one.
  useEffect(session.setup, [session]);
  return session;
}
