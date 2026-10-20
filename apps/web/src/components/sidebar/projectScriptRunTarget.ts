import type { ProjectId } from "@e6tools/contracts";
import { useSyncExternalStore } from "react";

let activeProjectId: ProjectId | null = null;
const listeners = new Set<() => void>();

/** ChatView publishes the project whose thread is on screen. Null means no chat is mounted. */
export function setProjectScriptRunTarget(projectId: ProjectId | null) {
  if (activeProjectId === projectId) return;
  activeProjectId = projectId;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useProjectScriptRunTarget(): ProjectId | null {
  return useSyncExternalStore(
    subscribe,
    () => activeProjectId,
    () => null,
  );
}
