import { type TurnId } from "@e6tools/contracts";
import { type MouseEvent, memo, useCallback, useMemo, useState } from "react";
import { type TurnDiffFileChange } from "../../types";
import {
  buildTurnDiffTree,
  summarizeTurnDiffStats,
  type TurnDiffTreeNode,
} from "../../lib/turnDiffTree";
import { ChevronRightIcon, FolderIcon, FolderTreeIcon, FolderClosedIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel";
import { PierreEntryIcon } from "./PierreEntryIcon";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MiddleTruncate } from "../ui/middle-truncate";

const EMPTY_DIRECTORY_OVERRIDES: Record<string, boolean> = {};

/** Opens the OS-level context menu for a changed file (reveal in file manager, open in editor). */
export type ChangedFileContextMenuHandler = (filePath: string, event: MouseEvent) => void;

/**
 * A turn's changed files: a header with the count, the line totals and Open diff, then the files
 * as a flat mono list with their own counts. The folder toggle swaps the list for the folder tree;
 * the persisted "all directories expanded" flag is that choice, so the tree opens fully expanded.
 */
export const ChangedFilesCard = memo(function ChangedFilesCard(props: {
  turnId: TurnId;
  files: ReadonlyArray<TurnDiffFileChange>;
  allDirectoriesExpanded: boolean;
  resolvedTheme: "light" | "dark";
  onToggleAllDirectories: () => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onFileContextMenu?: ChangedFileContextMenuHandler | undefined;
}) {
  const {
    turnId,
    files,
    allDirectoriesExpanded,
    resolvedTheme,
    onToggleAllDirectories,
    onOpenTurnDiff,
    onFileContextMenu,
  } = props;
  const summaryStat = useMemo(() => summarizeTurnDiffStats(files), [files]);
  const hasDirectories = files.some((file) => /[/\\]/.test(file.path));
  const showTree = hasDirectories && allDirectoriesExpanded;
  const viewToggleLabel = showTree ? "Show as a list" : "Show as folders";

  return (
    <div
      className="@container/changed-files mt-4 overflow-clip rounded-[10px] border border-input bg-background"
      data-changed-files-state={showTree ? "tree" : "list"}
    >
      <div
        data-changed-files-header=""
        className="sticky top-2 z-10 flex h-[38px] items-center gap-2.5 border-b border-border bg-surface-raised px-3"
      >
        <span className="text-xs font-medium text-foreground">
          {files.length} changed file{files.length === 1 ? "" : "s"}
        </span>
        {hasNonZeroStat(summaryStat) && (
          <DiffStatLabel
            additions={summaryStat.additions}
            deletions={summaryStat.deletions}
            layout="inline"
            className="text-[11px] leading-4"
          />
        )}
        <div className="ms-auto flex shrink-0 items-center gap-1">
          {hasDirectories && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={viewToggleLabel}
                    aria-pressed={showTree}
                    data-scroll-anchor-ignore
                    onClick={onToggleAllDirectories}
                  />
                }
              >
                <FolderTreeIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="top">{viewToggleLabel}</TooltipPopup>
            </Tooltip>
          )}
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="h-[26px] px-2.5 font-medium sm:h-[26px]"
            onClick={() => onOpenTurnDiff(turnId, files[0]?.path)}
          >
            Open diff
          </Button>
        </div>
      </div>
      {showTree ? (
        <ChangedFilesTree
          key={turnId}
          turnId={turnId}
          files={files}
          allDirectoriesExpanded
          resolvedTheme={resolvedTheme}
          onOpenTurnDiff={onOpenTurnDiff}
          onFileContextMenu={onFileContextMenu}
        />
      ) : (
        <ul className="py-1.5 font-mono text-xs leading-[26px]">
          {files.map((file) => (
            <li key={file.path}>
              <button
                type="button"
                className="group flex w-full items-center gap-3 px-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => onOpenTurnDiff(turnId, file.path)}
                onContextMenu={
                  onFileContextMenu
                    ? (event) => {
                        event.preventDefault();
                        onFileContextMenu(file.path, event);
                      }
                    : undefined
                }
              >
                <MiddleTruncate
                  value={file.path}
                  className="text-foreground/85 group-hover:text-foreground"
                />
                {typeof file.additions === "number" && typeof file.deletions === "number" ? (
                  <DiffStatLabel
                    additions={file.additions}
                    deletions={file.deletions}
                    layout="inline"
                    className="ms-auto shrink-0"
                  />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

export const ChangedFilesTree = memo(function ChangedFilesTree(props: {
  turnId: TurnId;
  files: ReadonlyArray<TurnDiffFileChange>;
  allDirectoriesExpanded: boolean;
  resolvedTheme: "light" | "dark";
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onFileContextMenu?: ChangedFileContextMenuHandler | undefined;
}) {
  const {
    files,
    allDirectoriesExpanded,
    onOpenTurnDiff,
    resolvedTheme,
    turnId,
    onFileContextMenu,
  } = props;
  const treeNodes = useMemo(() => buildTurnDiffTree(files), [files]);
  const directoryPathsKey = useMemo(
    () => collectDirectoryPaths(treeNodes).join("\u0000"),
    [treeNodes],
  );
  const hasDirectoryNodes = directoryPathsKey.length > 0;
  const expansionStateKey = `${allDirectoriesExpanded ? "expanded" : "collapsed"}\u0000${directoryPathsKey}`;
  const [directoryExpansionState, setDirectoryExpansionState] = useState<{
    key: string;
    overrides: Record<string, boolean>;
  }>(() => ({
    key: expansionStateKey,
    overrides: {},
  }));
  const expandedDirectories =
    directoryExpansionState.key === expansionStateKey
      ? directoryExpansionState.overrides
      : EMPTY_DIRECTORY_OVERRIDES;

  const toggleDirectory = useCallback(
    (pathValue: string) => {
      setDirectoryExpansionState((current) => {
        const nextOverrides = current.key === expansionStateKey ? current.overrides : {};
        return {
          key: expansionStateKey,
          overrides: {
            ...nextOverrides,
            [pathValue]: !(nextOverrides[pathValue] ?? allDirectoriesExpanded),
          },
        };
      });
    },
    [allDirectoriesExpanded, expansionStateKey],
  );

  const renderTreeNode = (node: TurnDiffTreeNode, depth: number) => {
    const leftPadding = 8 + depth * 14;
    if (node.kind === "directory") {
      const isExpanded = expandedDirectories[node.path] ?? allDirectoriesExpanded;
      return (
        <div key={`dir:${node.path}`}>
          <button
            type="button"
            data-scroll-anchor-ignore
            aria-expanded={isExpanded}
            className="group flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            style={{ paddingLeft: `${leftPadding}px` }}
            onClick={() => toggleDirectory(node.path)}
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:text-foreground/80",
                isExpanded && "rotate-90",
              )}
            />
            {isExpanded ? (
              <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
            ) : (
              <FolderClosedIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
            )}
            <span className="truncate font-mono text-[11px] text-muted-foreground/90 group-hover:text-foreground/90">
              {node.name}
            </span>
            {hasNonZeroStat(node.stat) && (
              <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums">
                <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
              </span>
            )}
          </button>
          {isExpanded && (
            <div>{node.children.map((childNode) => renderTreeNode(childNode, depth + 1))}</div>
          )}
        </div>
      );
    }

    return (
      <button
        key={`file:${node.path}`}
        type="button"
        className="group flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        style={{ paddingLeft: `${leftPadding}px` }}
        onClick={() => onOpenTurnDiff(turnId, node.path)}
        onContextMenu={
          onFileContextMenu
            ? (event) => {
                event.preventDefault();
                onFileContextMenu(node.path, event);
              }
            : undefined
        }
      >
        {hasDirectoryNodes || depth > 0 ? (
          <span aria-hidden="true" className="size-3.5 shrink-0" />
        ) : null}
        <PierreEntryIcon
          pathValue={node.path}
          kind="file"
          theme={resolvedTheme}
          className="size-3.5 text-muted-foreground/70"
        />
        <MiddleTruncate
          value={node.name}
          className="font-mono text-xs text-foreground/85 group-hover:text-foreground"
        />
        {node.stat && (
          <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums">
            <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
          </span>
        )}
      </button>
    );
  };

  return <div className="p-2">{treeNodes.map((node) => renderTreeNode(node, 0))}</div>;
});

function collectDirectoryPaths(nodes: ReadonlyArray<TurnDiffTreeNode>): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "directory") continue;
    paths.push(node.path);
    paths.push(...collectDirectoryPaths(node.children));
  }
  return paths;
}
