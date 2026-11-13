import { parseScopedProjectKey } from "@e6tools/client-runtime/environment";
import { useMemo } from "react";

import { captureProjectOptions } from "../components/CaptureBar.logic";
import { selectProjectGroupingSettings } from "../logicalProject";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { useProjects } from "../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useClientSettings } from "./useSettings";

/**
 * Projects as Park names them: one row per project group, labelled the way the
 * sidebar labels the group. The capture bar picks from these, and the Parked
 * list names a thought's project with the same label.
 */
export function useCaptureProjectOptions(preferredProjectKey: string | null) {
  const projects = useProjects();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  return useMemo(() => {
    const labelById = new Map(
      environments.map((environment) => [environment.environmentId, environment.label] as const),
    );
    return captureProjectOptions({
      groups: buildSidebarProjectSnapshots({
        projects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (environmentId) => labelById.get(environmentId) ?? null,
      }),
      primaryEnvironmentId,
      preferredProjectRef: preferredProjectKey ? parseScopedProjectKey(preferredProjectKey) : null,
    });
  }, [environments, preferredProjectKey, primaryEnvironmentId, projectGroupingSettings, projects]);
}
