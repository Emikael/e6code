import type { ReactNode, Ref } from "react";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";

import { PanelSurfaceHeader } from "./panel/PanelSurfaceHeader";
import { Skeleton } from "./ui/skeleton";

export type DiffPanelMode = "inline" | "sheet" | "sidebar" | "embedded";

/** Outside the right panel, an Electron diff window's header doubles as its title bar. */
const DIFF_PANEL_DRAG_HEADER_CLASS =
  "drag-region flex h-[var(--workspace-topbar-height)] items-center justify-between gap-2 border-b border-border px-4 wco:h-[env(titlebar-area-height)] wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]";

export function DiffPanelShell({
  rootRef,
  ...props
}: {
  mode: DiffPanelMode;
  header: ReactNode;
  children: ReactNode;
  /** The whole tab, header row included: the area the Diff's paging keys answer in. */
  rootRef?: Ref<HTMLDivElement>;
}) {
  const shouldUseDragRegion = isElectron && props.mode !== "sheet" && props.mode !== "embedded";

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex h-full min-w-0 flex-col bg-background",
        props.mode === "inline"
          ? "w-[42vw] min-w-[360px] max-w-[560px] shrink-0 border-l border-border"
          : "w-full",
      )}
    >
      {shouldUseDragRegion ? (
        <div className={DIFF_PANEL_DRAG_HEADER_CLASS}>{props.header}</div>
      ) : (
        <PanelSurfaceHeader className="justify-between">{props.header}</PanelSurfaceHeader>
      )}
      {props.children}
    </div>
  );
}

export function DiffFileHeaderSkeleton({ titleClassName }: { titleClassName: string }) {
  return (
    <div className="flex h-8 items-center gap-2 px-2 pr-3">
      <div className="flex size-5 shrink-0 items-center justify-center">
        <Skeleton className="size-2.5 rounded-[2px]" />
      </div>
      <Skeleton className="size-5 shrink-0 rounded-md" />
      <Skeleton className={cn("h-3 rounded-full", titleClassName)} />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Skeleton className="h-3 w-5 rounded-full" />
        <Skeleton className="h-3 w-5 rounded-full" />
      </div>
    </div>
  );
}

function DiffCodeLineSkeleton({ contentClassName }: { contentClassName: string }) {
  return (
    <div className="flex items-center gap-3">
      <Skeleton className="h-2.5 w-5 shrink-0 rounded-full" />
      <Skeleton className={cn("h-2.5 rounded-full", contentClassName)} />
    </div>
  );
}

export function DiffPanelLoadingState(props: { label: string }) {
  return (
    <div
      className="min-h-0 flex-1 overflow-hidden bg-background"
      role="status"
      aria-live="polite"
      aria-label={props.label}
    >
      <DiffFileHeaderSkeleton titleClassName="w-1/2 max-w-64" />
      <div className="flex h-6 items-center gap-2 px-2 pr-3">
        <div className="h-px flex-1 bg-border/40" />
        <Skeleton className="h-2.5 w-24 rounded-full" />
        <div className="h-px flex-1 bg-border/40" />
      </div>
      <div className="space-y-2 px-3 py-2">
        <DiffCodeLineSkeleton contentClassName="w-2/3" />
        <DiffCodeLineSkeleton contentClassName="w-4/5" />
        <DiffCodeLineSkeleton contentClassName="w-3/5" />
      </div>
      <DiffFileHeaderSkeleton titleClassName="w-2/5 max-w-52" />
      <DiffFileHeaderSkeleton titleClassName="w-3/5 max-w-72" />
      <span className="sr-only">{props.label}</span>
    </div>
  );
}
