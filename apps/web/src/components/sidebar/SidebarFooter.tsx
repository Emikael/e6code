import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@e6tools/client-runtime/state/runtime";
import { resolveEnvironmentMachineKind } from "@e6tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { environmentCatalog } from "../../connection/catalog";
import { cn } from "../../lib/utils";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import { connectionPhaseDotClassName, ConnectionStatusDot } from "../ConnectionStatusDot";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { ProviderMark } from "./primitives/ProviderMark";
import { UsageMeter } from "./primitives/UsageMeter";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import {
  formatUsageReset,
  selectSidebarUsageMeters,
  usageMeterAccessibleName,
} from "./SidebarFooter.logic";
import { SidebarFooter as SidebarFooterFrame, useSidebar } from "../ui/sidebar";

const DISCONNECTED_PHASES = new Set(["error", "offline", "unsupported"]);

export function SwitchboardSidebarFooter() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const retryEnvironment = useAtomCommand(environmentCatalog.retryNow, { reportFailure: false });
  const environment =
    environments.find((entry) => entry.environmentId === primaryEnvironmentId) ??
    environments[0] ??
    null;
  const meters = useMemo(
    () =>
      selectSidebarUsageMeters(
        environments.flatMap((entry) => entry.serverConfig?.providers ?? []),
      ),
    [environments],
  );
  const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const openConnections = () => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to: "/settings/connections" });
  };
  const retryConnection = async () => {
    if (!environment) return;
    const result = await retryEnvironment(environment.environmentId);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not reconnect environment",
        description: error instanceof Error ? error.message : "Failed to reconnect.",
      });
    }
  };
  const phase = environment?.connection.phase ?? "offline";
  const disconnected = DISCONNECTED_PHASES.has(phase);

  return (
    <SidebarFooterFrame className="gap-2 border-t border-sb-border px-3 py-2">
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarUpdatePill />
      {meters.length > 0 ? (
        <div className="flex flex-col gap-1">
          {meters.map((meter) => {
            const resetLabel = meter.resetsAt ? formatUsageReset(meter.resetsAt, timeZone) : null;
            return (
              <div
                key={meter.key}
                role="group"
                aria-label={usageMeterAccessibleName(meter, resetLabel)}
                className="flex min-w-0 items-center gap-1.5"
              >
                <ProviderMark provider={meter.provider} label={meter.label} />
                <UsageMeter
                  label={meter.windowLabel}
                  percent={meter.percent}
                  name={usageMeterAccessibleName(meter, resetLabel)}
                  className="min-w-0"
                />
              </div>
            );
          })}
        </div>
      ) : null}
      {environment ? (
        <button
          type="button"
          className={cn("sb-action h-auto w-full justify-start gap-1.5 px-0.5 text-sb-muted")}
          onClick={() => {
            if (disconnected) {
              void retryConnection();
              return;
            }
            openConnections();
          }}
        >
          <ConnectionStatusDot dotClassName={connectionPhaseDotClassName(phase)} />
          <EnvironmentMachineIcon
            aria-hidden
            kind={resolveEnvironmentMachineKind(environment.serverConfig)}
            className="size-3.5 shrink-0"
            strokeWidth={1.75}
          />
          <span className="truncate text-(length:--sb-text-meta)">
            {disconnected ? `${environment.label} unreachable · retry` : environment.label}
          </span>
        </button>
      ) : null}
    </SidebarFooterFrame>
  );
}
