import {
  parseScopedProjectKey,
  scopedProjectKey,
  scopeProjectRef,
} from "@e6tools/client-runtime/environment";
import type { ScopedProjectRef } from "@e6tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { dispatchSnapShotComposerFocus } from "../lib/desktopSnapShot";
import { readProject, readProjects, readThreadShell } from "../state/entities";
import { resolveThreadRouteTarget, type ThreadRouteTarget } from "../threadRoutes";
import { useNewThreadHandler } from "./useHandleNewThread";

/** The thread or draft on screen, if the route has one. */
function readRouteTarget(router: ReturnType<typeof useRouter>): ThreadRouteTarget | null {
  const params = router.state.matches[router.state.matches.length - 1]?.params ?? {};
  return resolveThreadRouteTarget(params);
}

/** The project of the thread or draft on screen, else null (Settings, Pull requests). */
export function readRouteProjectRef(target: ThreadRouteTarget | null): ScopedProjectRef | null {
  if (target?.kind === "server") {
    const shell = readThreadShell(target.threadRef);
    return shell ? scopeProjectRef(shell.environmentId, shell.projectId) : null;
  }
  if (target?.kind === "draft") {
    const draft = useComposerDraftStore.getState().getDraftSession(target.draftId);
    return draft ? scopeProjectRef(draft.environmentId, draft.projectId) : null;
  }
  return null;
}

/**
 * What parked text can turn into: a new thread with it in the composer, or
 * text added to the composer on screen. Neither sends anything by itself.
 */
export function useParkedActions() {
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();

  /** The project parked text belongs to: its own, else the one on screen, else the first. */
  const resolveProject = useCallback(
    (projectKey: string | null | undefined): ScopedProjectRef | null => {
      const parked = projectKey ? parseScopedProjectKey(projectKey) : null;
      if (parked && readProject(parked)) return parked;
      const onScreen = readRouteProjectRef(readRouteTarget(router));
      if (onScreen) return onScreen;
      const [first] = readProjects();
      return first ? scopeProjectRef(first.environmentId, first.id) : null;
    },
    [router],
  );

  /** Opens a new thread in the project with the text in its composer. */
  const startThreadWith = useCallback(
    async (text: string, projectKey: string | null | undefined): Promise<boolean> => {
      const projectRef = resolveProject(projectKey);
      if (!projectRef) return false;
      const created = await handleNewThread(projectRef);
      if (!created) return false;
      useComposerDraftStore.getState().setPrompt(created.draftId, text);
      dispatchSnapShotComposerFocus();
      return true;
    },
    [handleNewThread, resolveProject],
  );

  /** Adds the text to the composer on screen, or starts a thread when there is none. */
  const putInComposer = useCallback(
    async (text: string, projectKey: string | null | undefined): Promise<boolean> => {
      const target = readRouteTarget(router);
      if (!target) return startThreadWith(text, projectKey);
      const composerTarget = target.kind === "server" ? target.threadRef : target.draftId;
      const store = useComposerDraftStore.getState();
      const current = store.getComposerDraft(composerTarget)?.prompt ?? "";
      store.setPrompt(
        composerTarget,
        current.trim().length > 0 ? `${current.replace(/\s+$/, "")}\n\n${text}` : text,
      );
      dispatchSnapShotComposerFocus();
      return true;
    },
    [router, startThreadWith],
  );

  /**
   * Undo for `putInComposer`: takes the text back out of the composer on screen, but only
   * while it is still the composer's last paragraph as placed, so later typing is never lost.
   */
  const takeBackFromComposer = useCallback(
    (text: string) => {
      const target = readRouteTarget(router);
      if (!target) return;
      const composerTarget = target.kind === "server" ? target.threadRef : target.draftId;
      const store = useComposerDraftStore.getState();
      const current = store.getComposerDraft(composerTarget)?.prompt ?? "";
      if (current === text) store.setPrompt(composerTarget, "");
      else if (current.endsWith(`\n\n${text}`)) {
        store.setPrompt(composerTarget, current.slice(0, -(text.length + 2)));
      }
    },
    [router],
  );

  /** `scopedProjectKey` of the project on screen, for a thought parked here. */
  const currentProjectKey = useCallback((): string | null => {
    const projectRef = readRouteProjectRef(readRouteTarget(router));
    return projectRef ? scopedProjectKey(projectRef) : null;
  }, [router]);

  return {
    startThreadWith,
    putInComposer,
    takeBackFromComposer,
    currentProjectKey,
    resolveProject,
  };
}
