import { type StaticScreenProps } from "@react-navigation/native";
import { useMemo } from "react";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { NewTaskDraftScreen } from "./NewTaskDraftScreen";

type NewTaskDraftRouteParams = {
  readonly environmentId?: string | string[];
  readonly projectId?: string | string[];
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
  readonly title?: string | string[];
  /** Set by Add Project when this draft opens while the project's clone runs. */
  readonly cloning?: string | string[];
  readonly pendingTaskId?: string | string[];
  readonly draftId?: string | string[];
  readonly incomingShareId?: string | string[];
};

export function NewTaskDraftRouteScreen({ route }: StaticScreenProps<NewTaskDraftRouteParams>) {
  const params = useMemo(() => route.params ?? {}, [route.params]);
  const pendingTaskId = Array.isArray(params.pendingTaskId)
    ? params.pendingTaskId[0]
    : params.pendingTaskId;
  const draftId = Array.isArray(params.draftId) ? params.draftId[0] : params.draftId;

  // Keyed on the params object so a fresh navigation to this (already
  // mounted) screen produces a new reference, letting the draft screen
  // re-apply the requested project.
  const initialProjectRef = useMemo(
    () => ({
      environmentId: Array.isArray(params.environmentId)
        ? params.environmentId[0]
        : params.environmentId,
      projectId: Array.isArray(params.projectId) ? params.projectId[0] : params.projectId,
      branch: params.branch,
      worktreePath: params.worktreePath,
      cloning: (Array.isArray(params.cloning) ? params.cloning[0] : params.cloning) === "1",
    }),
    [params],
  );

  return (
    <>
      <NativeStackScreenOptions
        options={{
          title: Array.isArray(params.title) ? params.title[0] : (params.title ?? "New task"),
        }}
      />
      <NewTaskDraftScreen
        initialProjectRef={initialProjectRef}
        incomingShareId={
          Array.isArray(params.incomingShareId) ? params.incomingShareId[0] : params.incomingShareId
        }
        pendingTaskId={pendingTaskId}
        draftId={draftId}
      />
    </>
  );
}
