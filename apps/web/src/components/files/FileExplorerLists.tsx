import { ChevronDownIcon, ChevronRightIcon, FolderIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import type { RecentFile } from "~/uiStateStore";

import { DiffStat } from "../DiffStat";
import { Badge } from "../ui/badge";
import { Kbd } from "../ui/kbd";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  fileFolder,
  fileName,
  type FilesFilter,
  groupChangedFilesByFolder,
  type ThreadChangedFile,
} from "./threadChangedFiles";

/** Board 15's "All | Changed · 5" switch at the top of the explorer. */
export function FilesFilterSwitch(props: {
  readonly filter: FilesFilter;
  readonly changedCount: number;
  readonly onChange: (filter: FilesFilter) => void;
}) {
  return (
    <ToggleGroup
      size="segmented"
      variant="segmented"
      aria-label="Show"
      className="self-start"
      value={[props.filter]}
      onValueChange={(next) => {
        const filter = next[0];
        if (filter === "all" || filter === "changed") props.onChange(filter);
      }}
    >
      <Toggle value="all">All</Toggle>
      <Toggle value="changed">{`Changed · ${props.changedCount.toLocaleString()}`}</Toggle>
    </ToggleGroup>
  );
}

function SectionLabel(props: { readonly children: ReactNode }) {
  return (
    <div className="px-2 py-1 font-medium text-[11px] text-muted-foreground leading-[14px]">
      {props.children}
    </div>
  );
}

function FileRow(props: {
  readonly current: boolean;
  readonly indent?: boolean;
  readonly onOpen: () => void;
  readonly children: ReactNode;
  readonly label: string;
}) {
  return (
    <button
      type="button"
      aria-current={props.current ? "true" : undefined}
      aria-label={props.label}
      onClick={props.onOpen}
      className={cn(
        "flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        props.indent && "ps-7",
        // Selection is drawn with an edge: a fill change alone measured 1.2:1.
        props.current &&
          "bg-sidebar-row-selected ring-1 ring-primary-edge ring-inset hover:bg-sidebar-row-selected",
      )}
    >
      {props.children}
    </button>
  );
}

/**
 * The Changed filter's lists (board 15): the files this thread touched, grouped by folder with
 * counts, then the files recently opened here that are not among them. The open file is
 * highlighted wherever it appears.
 */
export function ChangedFileLists(props: {
  readonly changed: ReadonlyArray<ThreadChangedFile>;
  readonly recent: ReadonlyArray<RecentFile>;
  readonly selectedPath: string | null;
  readonly onOpenFile: (path: string, line: number | null) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const groups = groupChangedFilesByFolder(props.changed);
  return (
    <div className="flex min-h-0 flex-col gap-2.5">
      {groups.length > 0 ? (
        <div className="flex flex-col gap-px">
          <SectionLabel>Changed in this thread</SectionLabel>
          {groups.map((group) => {
            const open = !collapsed.has(group.folder);
            const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
            return (
              <div key={group.folder} className="flex flex-col gap-px">
                {group.folder === "" ? null : (
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (open) next.add(group.folder);
                        else next.delete(group.folder);
                        return next;
                      })
                    }
                    className="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <Chevron aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium text-[13px]">
                      {group.folder}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                      {group.files.length.toLocaleString()}
                    </span>
                  </button>
                )}
                {open || group.folder === ""
                  ? group.files.map((file) => (
                      <FileRow
                        key={file.path}
                        indent={group.folder !== ""}
                        current={file.path === props.selectedPath}
                        label={file.path}
                        onOpen={() => props.onOpenFile(file.path, null)}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">
                          {fileName(file.path)}
                        </span>
                        {file.isNew ? (
                          <Badge variant="outline" className="shrink-0">
                            new
                          </Badge>
                        ) : (
                          <DiffStat
                            tone="neutral"
                            notation="full"
                            additions={file.additions}
                            deletions={file.deletions}
                            className="shrink-0 text-[11px] text-muted-foreground"
                          />
                        )}
                      </FileRow>
                    ))
                  : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {props.recent.length > 0 ? (
        <div className="flex flex-col gap-px">
          <SectionLabel>Recently opened</SectionLabel>
          {props.recent.map((file) => (
            <FileRow
              key={file.path}
              current={file.path === props.selectedPath}
              label={file.path}
              onOpen={() => props.onOpenFile(file.path, file.line)}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {fileName(file.path)}
              </span>
              <span className="max-w-24 shrink-0 truncate text-muted-foreground text-xs">
                {fileFolder(file.path) || "root"}
              </span>
            </FileRow>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** "Browse all files ⌘ P": opens the file picker, which searches every file. */
export function BrowseAllFilesRow(props: {
  readonly shortcut: string | null;
  readonly onBrowse: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onBrowse}
      className="flex min-h-8 w-full min-w-0 shrink-0 items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <FolderIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 font-medium text-[13px]">Browse all files</span>
      {props.shortcut ? <Kbd className="text-[11px]">{props.shortcut}</Kbd> : null}
    </button>
  );
}
