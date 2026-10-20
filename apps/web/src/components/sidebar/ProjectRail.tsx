import { useAtomValue } from "@effect/atom-react";
import {
  closestCorners,
  DndContext,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToHorizontalAxis, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import type { SidebarProjectSortOrder } from "@e6tools/contracts/settings";
import { resolveEnvironmentMachineKind } from "@e6tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArrowUpDownIcon,
  ChartNoAxesColumnIcon,
  FoldersIcon,
  PlusIcon,
  SettingsIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { APP_VERSION } from "../../branding";
import { openCommandPalette } from "../../commandPaletteBus";
import { useUpdateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { getProjectOrderKey, selectProjectGroupingSettings } from "../../logicalProject";
import {
  buildSidebarProjectSnapshots,
  type SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects, useThreadShells } from "../../state/entities";
import { primaryServerProvidersAtom } from "../../state/server";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { resolveDesktopUpdateButtonAction } from "../desktopUpdate.logic";
import { E6Monogram } from "../E6Monogram";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { getProviderUpdateSidebarPillView } from "../ProviderUpdateLaunchNotification.logic";
import { ProjectFavicon } from "../ProjectFavicon";
import { useEnvironmentStageLabel } from "../SidebarStageBackdrop";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import {
  countThreadsForLogicalProject,
  orderItemsByPreferredIds,
  type ProjectSidebarCounts,
  selectSwitchboardRailProjects,
} from "../Sidebar.logic";
import { legacyProjectCwdPreferenceKey, useUiStateStore } from "../../uiStateStore";
import { useSidebar } from "../ui/sidebar";
import { Menu, MenuGroup, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";

const E6ConnectSidebarSignIn = lazy(() =>
  import("../clerk/E6ConnectSidebarSignIn").then((module) => ({
    default: module.E6ConnectSidebarSignIn,
  })),
);
const E6ConnectSidebarAvatar = lazy(() =>
  import("../clerk/E6ConnectSidebarSignIn").then((module) => ({
    default: module.E6ConnectSidebarAvatar,
  })),
);

const SORT_LABELS: Record<SidebarProjectSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
  manual: "Manual",
};

const DISCONNECTED_PHASES = new Set(["error", "offline", "unsupported"]);

function isUtilityPath(pathname: string): boolean {
  return (
    /^\/settings(?:\/|$)/.test(pathname) ||
    pathname === "/usage" ||
    pathname === "/pull-requests" ||
    /^\/projects\/[^/]+\/?$/.test(pathname)
  );
}

function railAccessibleName(name: string, counts: ProjectSidebarCounts): string {
  const parts = [name];
  if (counts.needYou > 0) parts.push(`${counts.needYou} need you`);
  if (counts.liveDot) parts.push("work running");
  return parts.join(", ");
}

export function ProjectRail({ orientation }: { orientation: "vertical" | "horizontal" }) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  const projects = useProjects();
  const threads = useThreadShells();
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const reorderProjects = useUiStateStore((store) => store.reorderProjects);
  const scopeKey = useUiStateStore((store) => store.sidebarProjectScopeKey);
  const setScopeKey = useUiStateStore((store) => store.setSidebarProjectScopeKey);
  const sortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const grouping = useClientSettings(selectProjectGroupingSettings);
  const updateSettings = useUpdateClientSettings();
  const { environments, isReady } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const desktopUpdate = useDesktopUpdateState();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const manual = sortOrder === "manual";
  const utility = isUtilityPath(pathname);
  const horizontal = orientation === "horizontal";
  const stageLabel = useEnvironmentStageLabel();
  const buildLabel = stageLabel === "Alpha" ? APP_VERSION : `${stageLabel} ${APP_VERSION}`;
  const suppressClickRef = useRef(false);
  const [rovingId, setRovingId] = useState<string | null>(null);

  const environmentById = useMemo(
    () => new Map(environments.map((environment) => [environment.environmentId, environment])),
    [environments],
  );
  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
        getPreferenceIds: (project) => [
          getProjectOrderKey(project),
          legacyProjectCwdPreferenceKey(project.workspaceRoot),
        ],
      }),
    [projectOrder, projects],
  );
  const snapshots = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects: manual ? orderedProjects : projects,
        settings: grouping,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (environmentId) =>
          environmentById.get(environmentId)?.label ?? null,
      }),
    [environmentById, grouping, manual, orderedProjects, primaryEnvironmentId, projects],
  );
  const railProjects = useMemo(
    () => selectSwitchboardRailProjects(snapshots, threads, sortOrder),
    [snapshots, sortOrder, threads],
  );
  const pullRequestsSupported = environments.some(
    (environment) => environment.serverConfig?.environment.capabilities.pullRequests === true,
  );
  const updateDot =
    (desktopUpdate !== null && resolveDesktopUpdateButtonAction(desktopUpdate) !== "none") ||
    getProviderUpdateSidebarPillView(providers) !== null;

  const closeMobile = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  const selectProject = useCallback(
    (projectKey: string | null) => {
      setScopeKey(projectKey);
      if (utility) {
        void navigate({ to: "/" });
      }
    },
    [navigate, setScopeKey, utility],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
  }, []);
  const handleDragStart = useCallback(
    (_event: DragStartEvent) => {
      if (!manual) return;
      suppressClickRef.current = true;
    },
    [manual],
  );
  const handleDragCancel = useCallback(() => {
    suppressClickRef.current = false;
  }, []);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!manual) {
        suppressClickRef.current = false;
        return;
      }
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeProject = railProjects.find((project) => project.projectKey === active.id);
      const overProject = railProjects.find((project) => project.projectKey === over.id);
      if (!activeProject || !overProject) return;
      reorderProjects(
        orderedProjects.map(getProjectOrderKey),
        activeProject.memberProjects.map((member) => member.physicalProjectKey),
        overProject.memberProjects.map((member) => member.physicalProjectKey),
      );
    },
    [manual, orderedProjects, railProjects, reorderProjects],
  );

  const itemIds = [
    "home",
    "all",
    ...railProjects.map((project) => project.projectKey),
    "add",
    "sort",
    ...(pullRequestsSupported ? ["pull-requests"] : []),
    "usage",
    "settings",
  ];
  const activeRovingId = rovingId !== null && itemIds.includes(rovingId) ? rovingId : itemIds[0]!;
  const tabIndexFor = (id: string) => (id === activeRovingId ? 0 : -1);

  const onRailKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const key = event.key;
    const nextKey =
      key === "Home"
        ? "first"
        : key === "End"
          ? "last"
          : horizontal
            ? key === "ArrowRight"
              ? "next"
              : key === "ArrowLeft"
                ? "previous"
                : null
            : key === "ArrowDown"
              ? "next"
              : key === "ArrowUp"
                ? "previous"
                : null;
    if (nextKey === null) return;
    const nav = event.currentTarget;
    const items = [
      ...nav.querySelectorAll<HTMLElement>("[data-rail-item]"),
      ...nav.querySelectorAll<HTMLElement>("[data-rail-account] button"),
    ];
    const index = items.findIndex(
      (item) => item === document.activeElement || item.contains(document.activeElement),
    );
    if (index < 0) return;
    const next =
      nextKey === "first"
        ? 0
        : nextKey === "last"
          ? items.length - 1
          : nextKey === "next"
            ? Math.min(items.length - 1, index + 1)
            : Math.max(0, index - 1);
    event.preventDefault();
    event.stopPropagation();
    const target = items[next];
    target?.focus();
    const id = target?.dataset.railId;
    if (id) setRovingId(id);
  };

  const projectTiles = railProjects.map((project) => {
    const tile = {
      project,
      counts: countThreadsForLogicalProject(project, threads),
      active: !utility && scopeKey === project.projectKey,
      horizontal,
      tabIndex: tabIndexFor(project.projectKey),
      disconnected: project.memberProjects.some((member) =>
        DISCONNECTED_PHASES.has(environmentById.get(member.environmentId)?.connection.phase ?? ""),
      ),
      machineKind:
        project.environmentPresence === "local-only"
          ? null
          : resolveEnvironmentMachineKind(
              environmentById.get(
                (
                  project.memberProjects.find(
                    (member) => member.environmentId !== primaryEnvironmentId,
                  ) ?? project.memberProjects[0]
                )?.environmentId ?? project.environmentId,
              )?.serverConfig ?? null,
            ),
      onFocus: () => setRovingId(project.projectKey),
      onSelect: () => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        selectProject(project.projectKey);
      },
    };
    return manual ? (
      <SortableProjectRailTile key={project.projectKey} {...tile} />
    ) : (
      <ProjectRailTile key={project.projectKey} {...tile} />
    );
  });

  const tiles = manual ? (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      modifiers={horizontal ? [restrictToHorizontalAxis] : [restrictToVerticalAxis]}
      onDragStart={handleDragStart}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={railProjects.map((project) => project.projectKey)}
        strategy={horizontal ? horizontalListSortingStrategy : verticalListSortingStrategy}
      >
        {projectTiles}
      </SortableContext>
    </DndContext>
  ) : (
    projectTiles
  );

  return (
    <TooltipProvider delay={300}>
      <nav
        aria-label="Projects"
        className={cn(
          "shrink-0 bg-sb-rail-bg",
          horizontal
            ? "flex h-[60px] w-full items-center gap-1 overflow-x-auto px-1"
            : "flex h-full w-[60px] flex-col items-center gap-1 overflow-y-auto pb-2 pt-[var(--workspace-topbar-height)]",
        )}
        onKeyDownCapture={onRailKeyDown}
      >
        <RailIconButton
          id="home"
          label={`Go to threads. E6 Code ${buildLabel}`}
          tooltip={<span className="tabular-nums">{buildLabel}</span>}
          tabIndex={tabIndexFor("home")}
          onFocus={() => setRovingId("home")}
          onClick={() => {
            closeMobile();
            void navigate({ to: "/" });
          }}
        >
          <E6Monogram className="size-5" />
        </RailIconButton>
        <RailIconButton
          id="all"
          label="All projects"
          current={!utility && scopeKey === null}
          horizontal={horizontal}
          tabIndex={tabIndexFor("all")}
          onFocus={() => setRovingId("all")}
          onClick={() => selectProject(null)}
        >
          <FoldersIcon aria-hidden className="size-4" strokeWidth={1.75} />
        </RailIconButton>
        <span
          aria-hidden
          className={cn(
            "bg-sb-border",
            horizontal ? "mx-0.5 h-6 w-px shrink-0" : "my-0.5 h-px w-6",
          )}
        />
        <div
          tabIndex={-1}
          className={cn(
            "flex min-h-0 gap-1",
            horizontal
              ? "shrink-0 items-center"
              : "w-full min-w-0 flex-1 flex-col items-center overflow-y-auto",
          )}
        >
          {!isReady && projects.length === 0 ? <RailSkeleton horizontal={horizontal} /> : tiles}
          <RailIconButton
            id="add"
            label="Add project"
            tabIndex={tabIndexFor("add")}
            className="border border-dashed border-sb-border"
            onFocus={() => setRovingId("add")}
            onClick={() => {
              closeMobile();
              openCommandPalette({ open: "add-project" });
            }}
          >
            <PlusIcon aria-hidden className="size-4" strokeWidth={1.75} />
          </RailIconButton>
        </div>
        <Menu>
          <Tooltip>
            <TooltipTrigger
              render={
                <MenuTrigger
                  id="rail-sort"
                  data-rail-item=""
                  data-rail-id="sort"
                  aria-label="Sort projects"
                  tabIndex={tabIndexFor("sort")}
                  className="sb-action size-9 text-sb-muted"
                  onFocus={() => setRovingId("sort")}
                />
              }
            >
              <ArrowUpDownIcon aria-hidden className="size-4" strokeWidth={1.75} />
            </TooltipTrigger>
            <TooltipPopup side={horizontal ? "bottom" : "right"}>Sort projects</TooltipPopup>
          </Tooltip>
          <MenuPopup align="start" side={horizontal ? "bottom" : "right"} className="min-w-52">
            <MenuGroup>
              <div className="px-2 py-1 text-xs font-medium text-sb-muted">Sort projects</div>
              <MenuRadioGroup
                value={sortOrder}
                onValueChange={(value) => {
                  updateSettings({ sidebarProjectSortOrder: value as SidebarProjectSortOrder });
                }}
              >
                {(Object.entries(SORT_LABELS) as Array<[SidebarProjectSortOrder, string]>).map(
                  ([value, label]) => (
                    <MenuRadioItem key={value} value={value} className="min-h-7 py-1 text-xs">
                      {label}
                    </MenuRadioItem>
                  ),
                )}
              </MenuRadioGroup>
            </MenuGroup>
          </MenuPopup>
        </Menu>
        {pullRequestsSupported ? (
          <RailIconButton
            id="pull-requests"
            label="Pull requests"
            current={pathname === "/pull-requests"}
            horizontal={horizontal}
            tabIndex={tabIndexFor("pull-requests")}
            onFocus={() => setRovingId("pull-requests")}
            onClick={() => {
              closeMobile();
              void navigate({ to: "/pull-requests", search: readPullRequestListPreferences() });
            }}
          >
            <PullRequestGlyph.pullRequest aria-hidden className="size-4" strokeWidth={1.75} />
          </RailIconButton>
        ) : null}
        <RailIconButton
          id="usage"
          label="Usage"
          current={pathname === "/usage"}
          horizontal={horizontal}
          tabIndex={tabIndexFor("usage")}
          onFocus={() => setRovingId("usage")}
          onClick={() => {
            closeMobile();
            void navigate({ to: "/usage" });
          }}
        >
          <ChartNoAxesColumnIcon aria-hidden className="size-4" strokeWidth={1.75} />
        </RailIconButton>
        <RailIconButton
          id="settings"
          label="Settings"
          current={/^\/settings(?:\/|$)/.test(pathname)}
          horizontal={horizontal}
          tabIndex={tabIndexFor("settings")}
          onFocus={() => setRovingId("settings")}
          onClick={() => {
            closeMobile();
            void navigate({ to: "/settings" });
          }}
        >
          <SettingsIcon aria-hidden className="size-4" strokeWidth={1.75} />
          {updateDot ? (
            <span
              aria-hidden
              className="absolute top-1 right-1 size-1.5 rounded-full"
              style={{ backgroundColor: "var(--state-approval)" }}
            />
          ) : null}
        </RailIconButton>
        <div className="[&_span]:sr-only">
          <Suspense fallback={null}>
            <E6ConnectSidebarSignIn />
          </Suspense>
        </div>
        <div data-rail-account="">
          <Suspense fallback={null}>
            <E6ConnectSidebarAvatar />
          </Suspense>
        </div>
      </nav>
    </TooltipProvider>
  );
}

function RailSkeleton({ horizontal }: { horizontal: boolean }) {
  return (
    <>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          aria-hidden
          className={cn("rounded-md bg-sb-hover", horizontal ? "size-8 shrink-0" : "size-8")}
        />
      ))}
    </>
  );
}

function RailIconButton({
  id,
  label,
  tooltip,
  current = false,
  horizontal = false,
  tabIndex,
  className,
  onFocus,
  onClick,
  children,
}: {
  id: string;
  label: string;
  tooltip?: ReactNode;
  current?: boolean;
  horizontal?: boolean;
  tabIndex: number;
  className?: string;
  onFocus: () => void;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-rail-item=""
            data-rail-id={id}
            aria-label={label}
            aria-current={current ? "page" : undefined}
            tabIndex={tabIndex}
            onFocus={onFocus}
            onClick={onClick}
            className={cn(
              "sb-action relative size-9 shrink-0 text-sb-foreground",
              current && "bg-sb-selection",
              className,
            )}
          />
        }
      >
        {current ? <ActiveBar horizontal={horizontal} /> : null}
        {children}
      </TooltipTrigger>
      <TooltipPopup side={horizontal ? "bottom" : "right"}>{tooltip ?? label}</TooltipPopup>
    </Tooltip>
  );
}

function ActiveBar({ horizontal }: { horizontal: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute rounded-full bg-sb-accent",
        horizontal ? "inset-x-1.5 top-0.5 h-0.5" : "inset-y-1.5 left-0.5 w-0.5",
      )}
    />
  );
}

function SortableProjectRailTile(props: ProjectRailTileProps) {
  const sortable = useSortable({ id: props.project.projectKey });
  const { tabIndex: _sortableTabIndex, ...dragAttributes } = sortable.attributes;
  return (
    <ProjectRailTile
      {...props}
      dragRef={sortable.setNodeRef}
      dragStyle={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      dragAttributes={dragAttributes}
      dragListeners={sortable.listeners}
      dragging={sortable.isDragging}
    />
  );
}

interface ProjectRailTileProps {
  project: SidebarProjectSnapshot;
  counts: ProjectSidebarCounts;
  active: boolean;
  horizontal: boolean;
  tabIndex: number;
  disconnected: boolean;
  machineKind: ReturnType<typeof resolveEnvironmentMachineKind> | null;
  onFocus: () => void;
  onSelect: () => void;
  dragRef?: (element: HTMLElement | null) => void;
  dragStyle?: { transform: string | undefined; transition: string | undefined };
  dragAttributes?: Omit<DraggableAttributes, "tabIndex"> | undefined;
  dragListeners?: DraggableSyntheticListeners;
  dragging?: boolean;
}

function ProjectRailTile({
  project,
  counts,
  active,
  horizontal,
  tabIndex,
  disconnected,
  machineKind,
  onFocus,
  onSelect,
  dragRef,
  dragStyle,
  dragAttributes,
  dragListeners,
  dragging = false,
}: ProjectRailTileProps) {
  const label = railAccessibleName(project.displayName, counts);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            ref={dragRef}
            data-rail-item=""
            data-rail-id={project.projectKey}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            onFocus={onFocus}
            onClick={onSelect}
            style={dragStyle}
            className={cn(
              "sb-action relative size-9 shrink-0 text-sb-foreground",
              active && "bg-sb-selection",
              disconnected && "opacity-50",
              dragging && "z-10",
            )}
            {...dragAttributes}
            {...dragListeners}
            tabIndex={tabIndex}
          />
        }
      >
        {active ? <ActiveBar horizontal={horizontal} /> : null}
        <ProjectFavicon project={project} className="size-5" monogramTone="solid" />
        {counts.badge ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -bottom-0.5 h-4 min-w-4 rounded-full px-1 text-center font-mono text-(length:--sb-text-meta) leading-4 font-semibold tabular-nums ring-2 ring-sb-rail-bg"
            style={{
              backgroundColor: `var(--state-${counts.badge.status})`,
              color: "var(--sb-rail-bg)",
            }}
          >
            {counts.badge.count}
          </span>
        ) : null}
        {counts.liveDot ? (
          <span
            aria-hidden
            className="absolute top-0.5 right-0.5 size-1.5 rounded-full"
            style={{ backgroundColor: "var(--state-working)" }}
          />
        ) : null}
        {disconnected ? (
          <TriangleAlertIcon
            aria-hidden
            className="absolute bottom-0 left-0 size-3 text-sb-foreground"
            strokeWidth={1.75}
          />
        ) : machineKind ? (
          <EnvironmentMachineIcon
            aria-hidden
            kind={machineKind}
            className="absolute bottom-0 left-0 size-3 text-sb-muted"
            strokeWidth={1.75}
          />
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side={horizontal ? "bottom" : "right"}>
        <span className="flex flex-col gap-0.5">
          <span>{project.displayName}</span>
          <span className="font-mono text-sb-muted">{project.workspaceRoot}</span>
          <span>
            {counts.needYou} need you · {counts.live} live · {counts.threads} threads
          </span>
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}
