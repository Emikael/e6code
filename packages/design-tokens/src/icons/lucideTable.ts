/**
 * Migration input for the Lucide removal codemod (E03-T03): every Lucide icon the web app
 * imports, by canonical lucide 0.564.0 name, with the specifiers as written and the registry
 * entry each becomes. Not for runtime use; the codemod deletes this file when it has run.
 *
 * A row has one default entry, so the codemod is a lookup. `overrides` give the entry for one
 * file where the new artwork differs by role; `manual` marks a file the codemod leaves to a hand
 * edit, such as a MorphIcon call site that becomes a morph or an iconSwap. `custom:` rows are
 * Lucide-style icons drawn in-app with `createLucideIcon`. Specifiers from `lucide` (not
 * `lucide-react`) are IconNode data that only MorphIcon draws; they become an iconSwap between
 * the two entries.
 */
import type { IconName } from "./registry.ts";

export interface LucideTableRow {
  readonly lucide: string;
  readonly specifiers: ReadonlyArray<{
    readonly package: "lucide-react" | "lucide";
    readonly name: string;
  }>;
  readonly icon: IconName;
  readonly overrides?: ReadonlyArray<{
    readonly file: string;
    readonly icon: IconName;
    readonly why: string;
    readonly manual?: true;
  }>;
}

export const LUCIDE_TABLE: ReadonlyArray<LucideTableRow> = [
  {
    lucide: "activity",
    specifiers: [{ package: "lucide-react", name: "ActivityIcon" }],
    icon: "activity",
  },
  {
    lucide: "alarm-clock",
    specifiers: [{ package: "lucide-react", name: "AlarmClockIcon" }],
    icon: "snooze",
  },
  {
    lucide: "alarm-clock-off",
    specifiers: [{ package: "lucide-react", name: "AlarmClockOffIcon" }],
    icon: "wake",
  },
  {
    lucide: "archive",
    specifiers: [{ package: "lucide-react", name: "ArchiveIcon" }],
    icon: "archive",
  },
  {
    lucide: "archive-x",
    specifiers: [{ package: "lucide-react", name: "ArchiveX" }],
    icon: "unarchive",
  },
  {
    lucide: "arrow-down",
    specifiers: [{ package: "lucide-react", name: "ArrowDownIcon" }],
    icon: "arrow-down",
  },
  {
    lucide: "arrow-down-right",
    specifiers: [{ package: "lucide-react", name: "ArrowDownRightIcon" }],
    icon: "arrow-down-right",
  },
  {
    lucide: "arrow-down-up",
    specifiers: [{ package: "lucide-react", name: "ArrowDownUpIcon" }],
    icon: "sort",
  },
  {
    lucide: "arrow-left",
    specifiers: [
      { package: "lucide-react", name: "ArrowLeft" },
      { package: "lucide-react", name: "ArrowLeftIcon" },
    ],
    icon: "arrow-left",
  },
  {
    lucide: "arrow-right",
    specifiers: [
      { package: "lucide-react", name: "ArrowRight" },
      { package: "lucide-react", name: "ArrowRightIcon" },
    ],
    icon: "arrow-right",
  },
  {
    lucide: "arrow-up",
    specifiers: [{ package: "lucide-react", name: "ArrowUpIcon" }],
    icon: "arrow-up",
  },
  {
    lucide: "arrow-up-down",
    specifiers: [{ package: "lucide-react", name: "ArrowUpDownIcon" }],
    icon: "sort",
  },
  {
    lucide: "arrow-up-right",
    specifiers: [{ package: "lucide-react", name: "ArrowUpRightIcon" }],
    icon: "arrow-up-right",
  },
  {
    lucide: "battery",
    specifiers: [{ package: "lucide-react", name: "BatteryIcon" }],
    icon: "battery",
  },
  {
    lucide: "battery-low",
    specifiers: [{ package: "lucide-react", name: "BatteryLowIcon" }],
    icon: "quota-low",
  },
  {
    lucide: "blocks",
    specifiers: [{ package: "lucide-react", name: "BlocksIcon" }],
    icon: "integrations",
  },
  {
    lucide: "book-open",
    specifiers: [{ package: "lucide-react", name: "BookOpenIcon" }],
    icon: "explain",
  },
  {
    lucide: "bookmark",
    specifiers: [{ package: "lucide-react", name: "BookmarkIcon" }],
    icon: "stash",
  },
  { lucide: "bot", specifiers: [{ package: "lucide-react", name: "BotIcon" }], icon: "agent" },
  {
    lucide: "braces",
    specifiers: [{ package: "lucide-react", name: "BracesIcon" }],
    icon: "script",
  },
  {
    lucide: "brain",
    specifiers: [{ package: "lucide-react", name: "BrainIcon" }],
    icon: "reasoning",
  },
  { lucide: "bug", specifiers: [{ package: "lucide-react", name: "BugIcon" }], icon: "debug" },
  {
    lucide: "calendar",
    specifiers: [{ package: "lucide-react", name: "CalendarIcon" }],
    icon: "calendar",
  },
  {
    lucide: "calendar-arrow-down",
    specifiers: [{ package: "lucide-react", name: "CalendarArrowDownIcon" }],
    icon: "sort-newest",
  },
  {
    lucide: "calendar-arrow-up",
    specifiers: [{ package: "lucide-react", name: "CalendarArrowUpIcon" }],
    icon: "sort-oldest",
  },
  { lucide: "camera", specifiers: [{ package: "lucide-react", name: "Camera" }], icon: "capture" },
  {
    lucide: "chart-no-axes-column",
    specifiers: [{ package: "lucide-react", name: "ChartNoAxesColumnIcon" }],
    icon: "usage",
  },
  {
    lucide: "check",
    specifiers: [
      { package: "lucide-react", name: "Check" },
      { package: "lucide-react", name: "CheckIcon" },
    ],
    icon: "check",
  },
  {
    lucide: "chevron-down",
    specifiers: [
      { package: "lucide-react", name: "ChevronDown" },
      { package: "lucide-react", name: "ChevronDownIcon" },
    ],
    icon: "chevron-down",
  },
  {
    lucide: "chevron-left",
    specifiers: [
      { package: "lucide-react", name: "ChevronLeft" },
      { package: "lucide-react", name: "ChevronLeftIcon" },
    ],
    icon: "chevron-left",
  },
  {
    lucide: "chevron-right",
    specifiers: [
      { package: "lucide-react", name: "ChevronRight" },
      { package: "lucide-react", name: "ChevronRightIcon" },
    ],
    icon: "chevron-right",
  },
  {
    lucide: "chevron-up",
    specifiers: [{ package: "lucide-react", name: "ChevronUpIcon" }],
    icon: "chevron-up",
  },
  {
    lucide: "chevrons-down-up",
    specifiers: [{ package: "lucide-react", name: "ChevronsDownUpIcon" }],
    icon: "collapse-all",
  },
  {
    lucide: "chevrons-left-right-ellipsis",
    specifiers: [{ package: "lucide-react", name: "ChevronsLeftRightEllipsisIcon" }],
    icon: "remote-link",
  },
  {
    lucide: "chevrons-up-down",
    specifiers: [{ package: "lucide-react", name: "ChevronsUpDownIcon" }],
    icon: "expand-all",
    overrides: [
      {
        file: "components/ui/autocomplete.tsx",
        icon: "selector",
        why: "Select trigger, not expand-all; Phosphor draws it as caret-up-down",
      },
      {
        file: "components/ui/calendar.tsx",
        icon: "selector",
        why: "Month and year dropdown trigger",
      },
      { file: "components/ui/combobox.tsx", icon: "selector", why: "Select trigger" },
    ],
  },
  {
    lucide: "circle",
    specifiers: [{ package: "lucide-react", name: "CircleIcon" }],
    icon: "circle",
  },
  {
    lucide: "circle-alert",
    specifiers: [
      { package: "lucide-react", name: "CircleAlert" },
      { package: "lucide-react", name: "CircleAlertIcon" },
    ],
    icon: "attention",
  },
  {
    lucide: "circle-arrow-up",
    specifiers: [
      { package: "lucide-react", name: "ArrowUpCircleIcon" },
      { package: "lucide-react", name: "CircleArrowUpIcon" },
    ],
    icon: "update-available",
  },
  {
    lucide: "circle-check",
    specifiers: [
      { package: "lucide-react", name: "CheckCircle2Icon" },
      { package: "lucide-react", name: "CircleCheckIcon" },
    ],
    icon: "success",
  },
  {
    lucide: "circle-dashed",
    specifiers: [{ package: "lucide-react", name: "CircleDashedIcon" }],
    icon: "pending",
  },
  {
    lucide: "circle-dot",
    specifiers: [{ package: "lucide-react", name: "CircleDotIcon" }],
    icon: "awaiting",
  },
  {
    lucide: "circle-pause",
    specifiers: [{ package: "lucide-react", name: "CirclePauseIcon" }],
    icon: "paused",
  },
  {
    lucide: "circle-slash",
    specifiers: [{ package: "lucide-react", name: "CircleSlashIcon" }],
    icon: "none",
  },
  {
    lucide: "circle-stop",
    specifiers: [{ package: "lucide-react", name: "CircleStopIcon" }],
    icon: "interrupt",
  },
  {
    lucide: "circle-x",
    specifiers: [
      { package: "lucide-react", name: "CircleXIcon" },
      { package: "lucide-react", name: "XCircleIcon" },
    ],
    icon: "failure",
  },
  { lucide: "clock", specifiers: [{ package: "lucide-react", name: "ClockIcon" }], icon: "clock" },
  { lucide: "cloud", specifiers: [{ package: "lucide-react", name: "CloudIcon" }], icon: "cloud" },
  {
    lucide: "cloud-download",
    specifiers: [{ package: "lucide-react", name: "CloudDownloadIcon" }],
    icon: "git-pull",
  },
  {
    lucide: "cloud-upload",
    specifiers: [{ package: "lucide-react", name: "CloudUploadIcon" }],
    icon: "git-push",
  },
  { lucide: "code-xml", specifiers: [{ package: "lucide-react", name: "Code2" }], icon: "code" },
  {
    lucide: "columns-2",
    specifiers: [{ package: "lucide-react", name: "Columns2Icon" }],
    icon: "split-view",
  },
  { lucide: "copy", specifiers: [{ package: "lucide-react", name: "CopyIcon" }], icon: "copy" },
  {
    lucide: "corner-left-up",
    specifiers: [{ package: "lucide-react", name: "CornerLeftUpIcon" }],
    icon: "parent-folder",
  },
  { lucide: "cpu", specifiers: [{ package: "lucide-react", name: "CpuIcon" }], icon: "cpu" },
  { lucide: "custom:snap-shot", specifiers: [], icon: "snap-shot" },
  { lucide: "custom:square-question-mark", specifiers: [], icon: "checklist-unknown" },
  {
    lucide: "database",
    specifiers: [{ package: "lucide-react", name: "DatabaseIcon" }],
    icon: "database",
  },
  {
    lucide: "download",
    specifiers: [{ package: "lucide-react", name: "DownloadIcon" }],
    icon: "download",
  },
  {
    lucide: "earth",
    specifiers: [
      { package: "lucide-react", name: "Globe2" },
      { package: "lucide-react", name: "Globe2Icon" },
    ],
    icon: "browser",
  },
  {
    lucide: "ellipsis",
    specifiers: [
      { package: "lucide-react", name: "EllipsisIcon" },
      { package: "lucide-react", name: "MoreHorizontalIcon" },
    ],
    icon: "more",
  },
  {
    lucide: "ellipsis-vertical",
    specifiers: [{ package: "lucide-react", name: "MoreVertical" }],
    icon: "more",
  },
  {
    lucide: "external-link",
    specifiers: [
      { package: "lucide-react", name: "ExternalLink" },
      { package: "lucide-react", name: "ExternalLinkIcon" },
    ],
    icon: "open-external",
  },
  {
    lucide: "eye",
    specifiers: [
      { package: "lucide-react", name: "Eye" },
      { package: "lucide-react", name: "EyeIcon" },
    ],
    icon: "eye",
  },
  {
    lucide: "eye-off",
    specifiers: [{ package: "lucide-react", name: "EyeOffIcon" }],
    icon: "hide",
  },
  { lucide: "file", specifiers: [{ package: "lucide-react", name: "FileIcon" }], icon: "file" },
  {
    lucide: "file-braces",
    specifiers: [{ package: "lucide-react", name: "FileJsonIcon" }],
    icon: "code-file",
  },
  {
    lucide: "file-code-corner",
    specifiers: [{ package: "lucide-react", name: "FileCode2Icon" }],
    icon: "code-file",
  },
  {
    lucide: "file-diff",
    specifiers: [
      { package: "lucide-react", name: "FileDiff" },
      { package: "lucide-react", name: "FileDiffIcon" },
    ],
    icon: "diff",
  },
  {
    lucide: "file-search",
    specifiers: [{ package: "lucide-react", name: "FileSearchIcon" }],
    icon: "find-file",
  },
  {
    lucide: "file-spreadsheet",
    specifiers: [{ package: "lucide-react", name: "FileSpreadsheetIcon" }],
    icon: "table",
  },
  {
    lucide: "file-text",
    specifiers: [{ package: "lucide-react", name: "FileTextIcon" }],
    icon: "document",
  },
  { lucide: "files", specifiers: [{ package: "lucide-react", name: "Files" }], icon: "files" },
  { lucide: "film", specifiers: [{ package: "lucide-react", name: "FilmIcon" }], icon: "video" },
  {
    lucide: "flask-conical",
    specifiers: [{ package: "lucide-react", name: "FlaskConicalIcon" }],
    icon: "test",
  },
  {
    lucide: "folder",
    specifiers: [{ package: "lucide-react", name: "FolderIcon" }],
    icon: "folder",
  },
  {
    lucide: "folder-closed",
    specifiers: [{ package: "lucide-react", name: "FolderClosedIcon" }],
    icon: "folder",
  },
  {
    lucide: "folder-code",
    specifiers: [{ package: "lucide-react", name: "FolderCodeIcon" }],
    icon: "folder",
  },
  {
    lucide: "folder-git",
    specifiers: [{ package: "lucide-react", name: "FolderGitIcon" }],
    icon: "worktree",
  },
  {
    lucide: "folder-git-2",
    specifiers: [{ package: "lucide-react", name: "FolderGit2Icon" }],
    icon: "worktree",
  },
  {
    lucide: "folder-open",
    specifiers: [{ package: "lucide-react", name: "FolderOpenIcon" }],
    icon: "folder-open",
  },
  {
    lucide: "folder-plus",
    specifiers: [{ package: "lucide-react", name: "FolderPlusIcon" }],
    icon: "add-project",
  },
  {
    lucide: "folder-tree",
    specifiers: [
      { package: "lucide-react", name: "FolderTree" },
      { package: "lucide-react", name: "FolderTreeIcon" },
    ],
    icon: "tree",
  },
  { lucide: "gauge", specifiers: [{ package: "lucide-react", name: "GaugeIcon" }], icon: "gauge" },
  {
    lucide: "git-branch",
    specifiers: [{ package: "lucide-react", name: "GitBranchIcon" }],
    icon: "branch",
  },
  {
    lucide: "git-branch-plus",
    specifiers: [{ package: "lucide-react", name: "GitBranchPlusIcon" }],
    icon: "new-branch",
  },
  {
    lucide: "git-commit-horizontal",
    specifiers: [
      { package: "lucide-react", name: "GitCommitHorizontalIcon" },
      { package: "lucide-react", name: "GitCommitIcon" },
    ],
    icon: "commit",
  },
  {
    lucide: "git-merge",
    specifiers: [{ package: "lucide-react", name: "GitMergeIcon" }],
    icon: "merged",
  },
  {
    lucide: "git-pull-request-arrow",
    specifiers: [{ package: "lucide-react", name: "GitPullRequestArrowIcon" }],
    icon: "pull-request",
  },
  {
    lucide: "git-pull-request-closed",
    specifiers: [{ package: "lucide-react", name: "GitPullRequestClosedIcon" }],
    icon: "pull-request-closed",
  },
  {
    lucide: "git-pull-request-draft",
    specifiers: [{ package: "lucide-react", name: "GitPullRequestDraftIcon" }],
    icon: "pull-request-draft",
  },
  {
    lucide: "globe",
    specifiers: [
      { package: "lucide-react", name: "Globe" },
      { package: "lucide-react", name: "GlobeIcon" },
    ],
    icon: "globe",
  },
  {
    lucide: "hammer",
    specifiers: [{ package: "lucide-react", name: "HammerIcon" }],
    icon: "build",
  },
  {
    lucide: "hard-drive",
    specifiers: [{ package: "lucide-react", name: "HardDriveIcon" }],
    icon: "storage",
  },
  {
    lucide: "history",
    specifiers: [
      { package: "lucide-react", name: "History" },
      { package: "lucide-react", name: "HistoryIcon" },
    ],
    icon: "history",
  },
  { lucide: "house", specifiers: [{ package: "lucide-react", name: "Home" }], icon: "home" },
  { lucide: "image", specifiers: [{ package: "lucide-react", name: "ImageIcon" }], icon: "image" },
  { lucide: "info", specifiers: [{ package: "lucide-react", name: "InfoIcon" }], icon: "info" },
  {
    lucide: "keyboard",
    specifiers: [{ package: "lucide-react", name: "KeyboardIcon" }],
    icon: "keyboard",
  },
  {
    lucide: "laptop",
    specifiers: [{ package: "lucide-react", name: "LaptopIcon" }],
    icon: "laptop",
  },
  {
    lucide: "layers",
    specifiers: [{ package: "lucide-react", name: "LayersIcon" }],
    icon: "layers",
  },
  {
    lucide: "lightbulb",
    specifiers: [{ package: "lucide-react", name: "LightbulbIcon" }],
    icon: "tip",
  },
  { lucide: "link", specifiers: [{ package: "lucide-react", name: "LinkIcon" }], icon: "link" },
  {
    lucide: "link-2",
    specifiers: [
      { package: "lucide-react", name: "Link2" },
      { package: "lucide-react", name: "Link2Icon" },
    ],
    icon: "link",
    overrides: [
      {
        file: "components/settings/SettingsSidebarNav.tsx",
        icon: "remote-link",
        why: "Connections settings destination: plugs-connected fills when selected, Phosphor link's fill is a knock-out tile",
      },
    ],
  },
  { lucide: "list", specifiers: [{ package: "lucide-react", name: "ListIcon" }], icon: "list" },
  {
    lucide: "list-checks",
    specifiers: [{ package: "lucide-react", name: "ListChecksIcon" }],
    icon: "checklist",
  },
  {
    lucide: "list-filter",
    specifiers: [{ package: "lucide-react", name: "ListFilterIcon" }],
    icon: "filter",
  },
  {
    lucide: "list-tree",
    specifiers: [{ package: "lucide-react", name: "ListTree" }],
    icon: "tree",
  },
  {
    lucide: "loader-circle",
    specifiers: [{ package: "lucide-react", name: "LoaderCircleIcon" }],
    icon: "spinner",
  },
  { lucide: "lock", specifiers: [{ package: "lucide-react", name: "LockIcon" }], icon: "lock" },
  {
    lucide: "lock-open",
    specifiers: [{ package: "lucide-react", name: "LockOpenIcon" }],
    icon: "unlock",
  },
  {
    lucide: "log-in",
    specifiers: [{ package: "lucide-react", name: "LogInIcon" }],
    icon: "sign-in",
  },
  { lucide: "mail", specifiers: [{ package: "lucide-react", name: "MailIcon" }], icon: "email" },
  {
    lucide: "maximize-2",
    specifiers: [
      { package: "lucide", name: "Maximize2" },
      { package: "lucide-react", name: "Maximize2Icon" },
    ],
    icon: "maximize",
    overrides: [
      {
        file: "components/chat/PanelLayoutControls.tsx",
        icon: "maximize",
        why: "MorphIcon (lucide data) becomes iconSwap maximize <-> minimize",
        manual: true,
      },
    ],
  },
  {
    lucide: "memory-stick",
    specifiers: [{ package: "lucide-react", name: "MemoryStickIcon" }],
    icon: "memory",
  },
  {
    lucide: "message-circle",
    specifiers: [
      { package: "lucide-react", name: "MessageCircle" },
      { package: "lucide-react", name: "MessageCircleIcon" },
    ],
    icon: "thread",
  },
  {
    lucide: "message-circle-question-mark",
    specifiers: [{ package: "lucide-react", name: "MessageCircleQuestionIcon" }],
    icon: "question",
  },
  {
    lucide: "message-square",
    specifiers: [{ package: "lucide-react", name: "MessageSquareIcon" }],
    icon: "comment",
  },
  {
    lucide: "message-square-off",
    specifiers: [{ package: "lucide-react", name: "MessageSquareOffIcon" }],
    icon: "comments-off",
  },
  {
    lucide: "message-square-text",
    specifiers: [{ package: "lucide-react", name: "MessageSquareTextIcon" }],
    icon: "message-text",
  },
  {
    lucide: "message-square-warning",
    specifiers: [{ package: "lucide-react", name: "MessageSquareWarningIcon" }],
    icon: "important",
  },
  {
    lucide: "minimize-2",
    specifiers: [
      { package: "lucide", name: "Minimize2" },
      { package: "lucide-react", name: "Minimize2Icon" },
    ],
    icon: "minimize",
    overrides: [
      {
        file: "components/chat/PanelLayoutControls.tsx",
        icon: "minimize",
        why: "MorphIcon (lucide data) becomes iconSwap maximize <-> minimize",
        manual: true,
      },
    ],
  },
  {
    lucide: "minus",
    specifiers: [
      { package: "lucide-react", name: "Minus" },
      { package: "lucide-react", name: "MinusIcon" },
    ],
    icon: "minus",
  },
  {
    lucide: "monitor",
    specifiers: [{ package: "lucide-react", name: "MonitorIcon" }],
    icon: "desktop",
  },
  {
    lucide: "moon",
    specifiers: [{ package: "lucide-react", name: "MoonIcon" }],
    icon: "theme-dark",
  },
  {
    lucide: "mouse-pointer-2",
    specifiers: [
      { package: "lucide-react", name: "MousePointer2" },
      { package: "lucide-react", name: "MousePointer2Icon" },
    ],
    icon: "pointer",
  },
  {
    lucide: "mouse-pointer-click",
    specifiers: [
      { package: "lucide-react", name: "MousePointerClick" },
      { package: "lucide-react", name: "MousePointerClickIcon" },
    ],
    icon: "pick-element",
  },
  {
    lucide: "octagon-alert",
    specifiers: [{ package: "lucide-react", name: "OctagonAlertIcon" }],
    icon: "caution",
  },
  {
    lucide: "package",
    specifiers: [{ package: "lucide-react", name: "PackageIcon" }],
    icon: "package",
  },
  {
    lucide: "package-plus",
    specifiers: [{ package: "lucide-react", name: "PackagePlusIcon" }],
    icon: "download",
  },
  {
    lucide: "paintbrush",
    specifiers: [{ package: "lucide-react", name: "PaintbrushIcon" }],
    icon: "paintbrush",
  },
  {
    lucide: "palette",
    specifiers: [{ package: "lucide-react", name: "PaletteIcon" }],
    icon: "theme",
  },
  {
    lucide: "panel-bottom",
    specifiers: [{ package: "lucide-react", name: "PanelBottomIcon" }],
    icon: "panel-bottom",
    overrides: [
      {
        file: "components/chat/PanelLayoutControls.tsx",
        icon: "panel-bottom",
        why: "Terminal-drawer toggle becomes MorphIcon ICON_MORPHS['panel-bottom'] (open/closed)",
        manual: true,
      },
    ],
  },
  {
    lucide: "panel-left",
    specifiers: [{ package: "lucide-react", name: "PanelLeftIcon" }],
    icon: "sidebar",
    overrides: [
      {
        file: "components/ui/sidebar.tsx",
        icon: "sidebar",
        why: "Sidebar toggle becomes MorphIcon ICON_MORPHS.sidebar (open/closed) instead of swapping two glyphs",
        manual: true,
      },
    ],
  },
  {
    lucide: "panel-left-close",
    specifiers: [{ package: "lucide-react", name: "PanelLeftCloseIcon" }],
    icon: "sidebar",
    overrides: [
      {
        file: "components/ui/sidebar.tsx",
        icon: "sidebar",
        why: "Closing state is the morph's open end state",
        manual: true,
      },
    ],
  },
  {
    lucide: "panel-right",
    specifiers: [{ package: "lucide-react", name: "PanelRightIcon" }],
    icon: "panel-right",
    overrides: [
      {
        file: "components/chat/PanelLayoutControls.tsx",
        icon: "panel-right",
        why: "Right-panel toggle becomes MorphIcon ICON_MORPHS['panel-right'] (open/closed)",
        manual: true,
      },
    ],
  },
  {
    lucide: "panels-top-left",
    specifiers: [{ package: "lucide-react", name: "PanelsTopLeftIcon" }],
    icon: "project-settings",
  },
  {
    lucide: "paperclip",
    specifiers: [{ package: "lucide-react", name: "PaperclipIcon" }],
    icon: "attachment",
  },
  { lucide: "pause", specifiers: [{ package: "lucide-react", name: "PauseIcon" }], icon: "pause" },
  {
    lucide: "pen-line",
    specifiers: [{ package: "lucide-react", name: "PenLineIcon" }],
    icon: "write",
  },
  { lucide: "pencil", specifiers: [{ package: "lucide-react", name: "PencilIcon" }], icon: "edit" },
  {
    lucide: "pencil-ruler",
    specifiers: [{ package: "lucide-react", name: "PencilRulerIcon" }],
    icon: "plan-mode",
  },
  {
    lucide: "picture-in-picture-2",
    specifiers: [{ package: "lucide-react", name: "PictureInPicture2" }],
    icon: "pip",
  },
  {
    lucide: "pilcrow",
    specifiers: [{ package: "lucide-react", name: "PilcrowIcon" }],
    icon: "whitespace",
  },
  { lucide: "pin", specifiers: [{ package: "lucide-react", name: "PinIcon" }], icon: "pin" },
  {
    lucide: "pin-off",
    specifiers: [{ package: "lucide-react", name: "PinOffIcon" }],
    icon: "unpin",
  },
  {
    lucide: "pipette",
    specifiers: [{ package: "lucide-react", name: "PipetteIcon" }],
    icon: "eyedropper",
  },
  { lucide: "play", specifiers: [{ package: "lucide-react", name: "PlayIcon" }], icon: "play" },
  {
    lucide: "plug-2",
    specifiers: [{ package: "lucide-react", name: "Plug2Icon" }],
    icon: "git-host",
  },
  {
    lucide: "plus",
    specifiers: [
      { package: "lucide-react", name: "Plus" },
      { package: "lucide-react", name: "PlusIcon" },
    ],
    icon: "add",
  },
  { lucide: "power", specifiers: [{ package: "lucide-react", name: "Power" }], icon: "power" },
  {
    lucide: "presentation",
    specifiers: [{ package: "lucide-react", name: "PresentationIcon" }],
    icon: "presentation",
  },
  {
    lucide: "qr-code",
    specifiers: [{ package: "lucide-react", name: "QrCodeIcon" }],
    icon: "qr-code",
  },
  { lucide: "quote", specifiers: [{ package: "lucide-react", name: "QuoteIcon" }], icon: "quote" },
  {
    lucide: "radio-tower",
    specifiers: [{ package: "lucide-react", name: "RadioTower" }],
    icon: "local-servers",
  },
  {
    lucide: "refresh-cw",
    specifiers: [{ package: "lucide-react", name: "RefreshCwIcon" }],
    icon: "refresh",
  },
  {
    lucide: "rotate-ccw",
    specifiers: [
      { package: "lucide-react", name: "RotateCcw" },
      { package: "lucide-react", name: "RotateCcwIcon" },
    ],
    icon: "restore",
    overrides: [
      {
        file: "components/device/DevicePanel.tsx",
        icon: "rotate-device",
        why: "The device Rotate button; Phosphor device-rotate differs from the restore arrow",
      },
    ],
  },
  {
    lucide: "rotate-cw",
    specifiers: [{ package: "lucide-react", name: "RotateCwIcon" }],
    icon: "retry",
  },
  {
    lucide: "rows-3",
    specifiers: [{ package: "lucide-react", name: "Rows3Icon" }],
    icon: "stacked-view",
  },
  {
    lucide: "scale",
    specifiers: [{ package: "lucide-react", name: "ScaleIcon" }],
    icon: "auto-balance",
  },
  {
    lucide: "search",
    specifiers: [{ package: "lucide-react", name: "SearchIcon" }],
    icon: "search",
  },
  { lucide: "send", specifiers: [{ package: "lucide-react", name: "SendIcon" }], icon: "send" },
  {
    lucide: "server",
    specifiers: [{ package: "lucide-react", name: "ServerIcon" }],
    icon: "server",
  },
  {
    lucide: "settings",
    specifiers: [{ package: "lucide-react", name: "SettingsIcon" }],
    icon: "settings",
  },
  {
    lucide: "settings-2",
    specifiers: [{ package: "lucide-react", name: "Settings2Icon" }],
    icon: "settings",
  },
  {
    lucide: "shield",
    specifiers: [{ package: "lucide-react", name: "ShieldIcon" }],
    icon: "permission",
  },
  {
    lucide: "shield-off",
    specifiers: [{ package: "lucide-react", name: "ShieldOffIcon" }],
    icon: "full-access",
  },
  {
    lucide: "shield-question-mark",
    specifiers: [{ package: "lucide-react", name: "ShieldQuestionIcon" }],
    icon: "approval-needed",
  },
  {
    lucide: "sliders-horizontal",
    specifiers: [
      { package: "lucide-react", name: "SlidersHorizontal" },
      { package: "lucide-react", name: "SlidersHorizontalIcon" },
    ],
    icon: "sliders",
    overrides: [
      {
        file: "components/AppNavRail.tsx",
        icon: "settings",
        why: "The rail's Settings destination must fill when selected; the gear does, sliders-horizontal does not",
      },
    ],
  },
  {
    lucide: "smartphone",
    specifiers: [
      { package: "lucide-react", name: "Smartphone" },
      { package: "lucide-react", name: "SmartphoneIcon" },
    ],
    icon: "device",
  },
  {
    lucide: "smile-plus",
    specifiers: [{ package: "lucide-react", name: "SmilePlusIcon" }],
    icon: "add-reaction",
  },
  {
    lucide: "sparkles",
    specifiers: [{ package: "lucide-react", name: "SparklesIcon" }],
    icon: "sparkles",
  },
  {
    lucide: "square",
    specifiers: [
      { package: "lucide-react", name: "Square" },
      { package: "lucide-react", name: "SquareIcon" },
    ],
    icon: "square",
    overrides: [
      {
        file: "components/subagents/SubagentParts.tsx",
        icon: "stop",
        why: "Stopped subagent; Phosphor stop is the inset media square, not the frame",
      },
      {
        file: "components/settings/MotionSettingRow.tsx",
        icon: "stop",
        why: "Motion off; the stop glyph beside pause (reduced) and pulse (full)",
      },
    ],
  },
  {
    lucide: "square-arrow-out-up-right",
    specifiers: [{ package: "lucide-react", name: "SquareArrowOutUpRightIcon" }],
    icon: "open-external",
  },
  {
    lucide: "square-check",
    specifiers: [{ package: "lucide-react", name: "SquareCheckIcon" }],
    icon: "checklist-done",
  },
  {
    lucide: "square-dashed",
    specifiers: [{ package: "lucide-react", name: "SquareDashedIcon" }],
    icon: "checklist-waiting",
  },
  {
    lucide: "square-dot",
    specifiers: [{ package: "lucide-react", name: "SquareDotIcon" }],
    icon: "checklist-active",
  },
  {
    lucide: "square-pen",
    specifiers: [{ package: "lucide-react", name: "SquarePenIcon" }],
    icon: "compose",
  },
  {
    lucide: "square-split-horizontal",
    specifiers: [{ package: "lucide-react", name: "SquareSplitHorizontal" }],
    icon: "split-side-by-side",
  },
  {
    lucide: "square-split-vertical",
    specifiers: [{ package: "lucide-react", name: "SquareSplitVertical" }],
    icon: "split-stacked",
  },
  {
    lucide: "square-terminal",
    specifiers: [{ package: "lucide-react", name: "TerminalSquare" }],
    icon: "terminal-panel",
  },
  {
    lucide: "square-x",
    specifiers: [{ package: "lucide-react", name: "SquareXIcon" }],
    icon: "checklist-blocked",
  },
  { lucide: "star", specifiers: [{ package: "lucide-react", name: "StarIcon" }], icon: "star" },
  {
    lucide: "sun",
    specifiers: [{ package: "lucide-react", name: "SunIcon" }],
    icon: "theme-light",
  },
  { lucide: "table-2", specifiers: [{ package: "lucide-react", name: "Table2" }], icon: "table" },
  { lucide: "tag", specifiers: [{ package: "lucide-react", name: "TagIcon" }], icon: "tag" },
  {
    lucide: "terminal",
    specifiers: [{ package: "lucide-react", name: "TerminalIcon" }],
    icon: "terminal",
  },
  {
    lucide: "text-align-start",
    specifiers: [{ package: "lucide-react", name: "TextIcon" }],
    icon: "text",
  },
  {
    lucide: "text-search",
    specifiers: [{ package: "lucide-react", name: "TextSearchIcon" }],
    icon: "search-contents",
  },
  {
    lucide: "text-wrap",
    specifiers: [
      { package: "lucide-react", name: "TextWrapIcon" },
      { package: "lucide-react", name: "WrapTextIcon" },
    ],
    icon: "word-wrap",
  },
  {
    lucide: "ticket",
    specifiers: [{ package: "lucide-react", name: "TicketIcon" }],
    icon: "ticket",
  },
  {
    lucide: "trash-2",
    specifiers: [
      { package: "lucide-react", name: "Trash2" },
      { package: "lucide-react", name: "Trash2Icon" },
    ],
    icon: "delete",
  },
  {
    lucide: "trending-down",
    specifiers: [{ package: "lucide-react", name: "TrendingDownIcon" }],
    icon: "trend-down",
  },
  {
    lucide: "trending-up",
    specifiers: [{ package: "lucide-react", name: "TrendingUpIcon" }],
    icon: "trend-up",
  },
  {
    lucide: "triangle-alert",
    specifiers: [
      { package: "lucide-react", name: "AlertTriangleIcon" },
      { package: "lucide-react", name: "TriangleAlertIcon" },
    ],
    icon: "warning",
  },
  { lucide: "undo-2", specifiers: [{ package: "lucide-react", name: "Undo2Icon" }], icon: "undo" },
  {
    lucide: "unlink-2",
    specifiers: [
      { package: "lucide-react", name: "Unlink2" },
      { package: "lucide-react", name: "Unlink2Icon" },
    ],
    icon: "unlink",
  },
  {
    lucide: "upload",
    specifiers: [{ package: "lucide-react", name: "UploadIcon" }],
    icon: "upload",
  },
  {
    lucide: "user-check",
    specifiers: [{ package: "lucide-react", name: "UserCheckIcon" }],
    icon: "review-approved",
  },
  {
    lucide: "user-lock",
    specifiers: [{ package: "lucide-react", name: "UserLockIcon" }],
    icon: "blocked-on-me",
  },
  {
    lucide: "user-plus",
    specifiers: [{ package: "lucide-react", name: "UserPlusIcon" }],
    icon: "request-review",
  },
  {
    lucide: "user-round",
    specifiers: [{ package: "lucide-react", name: "UserRoundIcon" }],
    icon: "person",
  },
  {
    lucide: "user-round-x",
    specifiers: [{ package: "lucide-react", name: "UserRoundXIcon" }],
    icon: "changes-requested",
  },
  { lucide: "users", specifiers: [{ package: "lucide-react", name: "UsersIcon" }], icon: "users" },
  {
    lucide: "volume-2",
    specifiers: [{ package: "lucide", name: "Volume2" }],
    icon: "volume",
    overrides: [
      {
        file: "components/RightPanelTabs.tsx",
        icon: "volume",
        why: "MorphIcon (lucide data) becomes iconSwap volume <-> muted",
        manual: true,
      },
    ],
  },
  {
    lucide: "volume-off",
    specifiers: [{ package: "lucide", name: "VolumeOff" }],
    icon: "muted",
    overrides: [
      {
        file: "components/RightPanelTabs.tsx",
        icon: "muted",
        why: "MorphIcon (lucide data) becomes iconSwap volume <-> muted",
        manual: true,
      },
    ],
  },
  {
    lucide: "wifi-off",
    specifiers: [{ package: "lucide-react", name: "WifiOffIcon" }],
    icon: "offline",
  },
  {
    lucide: "wrench",
    specifiers: [{ package: "lucide-react", name: "WrenchIcon" }],
    icon: "configure",
  },
  {
    lucide: "x",
    specifiers: [
      { package: "lucide-react", name: "X" },
      { package: "lucide-react", name: "XIcon" },
    ],
    icon: "close",
  },
  { lucide: "zap", specifiers: [{ package: "lucide-react", name: "ZapIcon" }], icon: "fast" },
];

/** The MorphIcon morphs E6 drops (design direction 6.3); each becomes an iconSwap of two entries. */
export const MORPHS_BECOMING_ICON_SWAPS = [
  { morph: "volume-mute", file: "components/RightPanelTabs.tsx", icons: ["volume", "muted"] },
  {
    morph: "panel-maximize",
    file: "components/chat/PanelLayoutControls.tsx",
    icons: ["maximize", "minimize"],
  },
] as const satisfies ReadonlyArray<{
  readonly morph: string;
  readonly file: string;
  readonly icons: readonly [IconName, IconName];
}>;

/** The roles in `PullRequestGlyph` (apps/web/src/components/pullRequest/pullRequestIcons.tsx). */
export const PULL_REQUEST_GLYPH_ICON = {
  pullRequest: "pull-request",
  reopen: "pull-request",
  draft: "pull-request-draft",
  closed: "pull-request-closed",
  merged: "merged",
  conflicting: "warning",
  stack: "layers",
  link: "link",
  unlink: "unlink",
} as const satisfies Record<string, IconName>;
