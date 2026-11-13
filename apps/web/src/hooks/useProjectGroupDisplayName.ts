import { scopedProjectKey, scopeProjectRef } from "@e6tools/client-runtime/environment";
import { useMemo } from "react";

import { selectProjectGroupingSettings } from "../logicalProject";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useProjects } from "../state/entities";
import type { Project } from "../types";
import { useClientSettings } from "./useSettings";

/**
 * The names the sidebar and the draft hero show for every project, keyed by
 * scoped project key: each project's logical group display name, which can
 * differ from the project's own title when grouping combines checkouts of one
 * repository. Lists that name projects per row read from this map so one
 * screen uses one name per project.
 */
export function useProjectGroupDisplayNames(): ReadonlyMap<string, string> {
  const projects = useProjects();
  const settings = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  return useMemo(() => {
    const labels = new Map(environments.map((entry) => [entry.environmentId, entry.label]));
    const names = new Map<string, string>();
    for (const group of buildSidebarProjectSnapshots({
      projects,
      settings,
      primaryEnvironmentId,
      resolveEnvironmentLabel: (id) => labels.get(id) ?? null,
    })) {
      for (const ref of group.memberProjectRefs)
        names.set(scopedProjectKey(ref), group.displayName);
    }
    return names;
  }, [environments, primaryEnvironmentId, projects, settings]);
}

/** The name the sidebar and the draft hero show for `project`. Null without a project. */
export function useProjectGroupDisplayName(project: Project | null): string | null {
  const names = useProjectGroupDisplayNames();
  if (!project) return null;
  return names.get(scopedProjectKey(scopeProjectRef(project.environmentId, project.id))) ?? null;
}
