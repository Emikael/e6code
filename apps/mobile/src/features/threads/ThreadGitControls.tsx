import { createNativeHeaderMenu } from "../../components/nativeHeaderMenu.ios";
import type { ScreenHeaderMenu } from "../../components/ScreenHeader.types";
import {
  EnvironmentId,
  type GitRunStackedActionResult,
  type ProjectScript,
  ThreadId,
  type VcsStatusResult,
} from "@e6tools/contracts";
import {
  type GitActionRequestInput,
  requiresDefaultBranchConfirmation,
  resolveQuickAction,
} from "@e6tools/client-runtime/state/vcs";
import { useNavigation } from "@react-navigation/native";
import { useCallback, useMemo } from "react";
import { Alert } from "react-native";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import {
  basename,
  getTerminalStatusLabel,
  projectScriptMenuIcon,
  projectScriptMenuLabel,
  type TerminalMenuSession,
} from "../terminal/terminalMenu";

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const headLength = Math.ceil((maxLength - 1) / 2);
  const tailLength = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, headLength)}…${value.slice(value.length - tailLength)}`;
}

function compactMenuBranchLabel(branch: string): string {
  return truncateMiddle(branch, 24);
}

function compactMenuStatus(gitStatus: VcsStatusResult | null): string {
  if (!gitStatus) {
    return "Checking status";
  }
  if (!gitStatus.isRepo) {
    return "Not a repo";
  }

  const parts: string[] = [];
  if (gitStatus.hasWorkingTreeChanges) {
    parts.push(`${gitStatus.workingTree.files.length} changed`);
  } else if (gitStatus.aheadCount === 0 && gitStatus.behindCount === 0) {
    parts.push("Clean");
  }
  if (gitStatus.aheadCount > 0) {
    parts.push(`${gitStatus.aheadCount} ahead`);
  }
  if (gitStatus.behindCount > 0) {
    parts.push(`${gitStatus.behindCount} behind`);
  }
  if (gitStatus.pr?.state === "open") {
    parts.push(`PR #${gitStatus.pr.number}`);
  }

  return parts.join(" · ");
}

type HeaderItem = Record<string, unknown>;
type HeaderItems = HeaderItem[];
type ThreadGitHeaderActionItems = {
  readonly inspector: HeaderItem | null;
  readonly terminal: HeaderItem;
  readonly files: HeaderItem;
  readonly git: HeaderItem;
};
type QuickActionIcon =
  | "arrow.down.circle"
  | "arrow.up.right.circle"
  | "checkmark.circle"
  | "arrow.up.circle";

/** The subset of git-control wiring the standalone git menu needs. */
export type ThreadGitMenuProps = {
  readonly environmentId: EnvironmentId | string;
  readonly threadId: ThreadId | string;
  readonly currentBranch: string | null;
  readonly gitStatus: VcsStatusResult | null;
  readonly gitOperationLabel: string | null;
  readonly onOpenFilesInspector?: () => void;
  readonly onOpenGitInspector?: () => void;
  readonly onPull: () => Promise<void>;
  readonly onRunAction: (input: GitActionRequestInput) => Promise<GitRunStackedActionResult | null>;
};

export type ThreadGitControlsProps = ThreadGitMenuProps & {
  readonly auxiliaryPaneControl?: {
    readonly accessibilityLabel: string;
    readonly onPress: () => void;
  };
  /** Opens the thread Inspector sheet; the badge counts running subagents. */
  readonly inspectorControl?: {
    readonly accessibilityLabel: string;
    readonly badgeCount: number;
    /** Native badges take concrete colors: a foreground fill with screen text. */
    readonly badgeColors: { readonly fill: string; readonly text: string };
    readonly onPress: () => void;
  };
  readonly canOpenTerminal: boolean;
  readonly canOpenFiles: boolean;
  readonly projectScripts: ReadonlyArray<ProjectScript>;
  readonly terminalSessions: ReadonlyArray<TerminalMenuSession>;
  readonly showDirectFileControl?: boolean;
  readonly onOpenTerminal: (terminalId?: string | null) => void;
  readonly onOpenNewTerminal: () => void;
  readonly onRunProjectScript: (script: ProjectScript) => Promise<void>;
};

function useThreadGitControlModel(props: ThreadGitMenuProps) {
  const navigation = useNavigation();
  const environmentId = props.environmentId;
  const threadId = props.threadId;
  const { gitStatus, gitOperationLabel, onPull, onRunAction } = props;

  const currentBranchLabel = gitStatus?.refName ?? props.currentBranch ?? "Detached HEAD";
  const busy = gitOperationLabel !== null;
  const isRepo = gitStatus?.isRepo ?? true;
  const hasPrimaryRemote = gitStatus?.hasPrimaryRemote ?? false;
  const isDefaultRef = gitStatus?.isDefaultRef ?? false;

  const quickAction = useMemo(
    () =>
      isRepo
        ? resolveQuickAction(gitStatus, busy, isDefaultRef, hasPrimaryRemote)
        : {
            label: "Git unavailable",
            disabled: true,
            kind: "show_hint" as const,
            hint: "This workspace is not a git repository.",
          },
    [busy, gitStatus, hasPrimaryRemote, isDefaultRef, isRepo],
  );

  const quickActionHint = quickAction.disabled
    ? (quickAction.hint ?? "This action is unavailable.")
    : null;

  const quickActionIcon: QuickActionIcon = (() => {
    if (quickAction.kind === "run_pull") return "arrow.down.circle";
    if (quickAction.kind === "open_pr") return "arrow.up.right.circle";
    if (quickAction.kind === "run_action") {
      if (quickAction.action === "commit") return "checkmark.circle";
      if (quickAction.action === "push" || quickAction.action === "commit_push")
        return "arrow.up.circle";
    }
    return "arrow.up.right.circle";
  })();

  const openExistingPr = useCallback(async () => {
    const prUrl = gitStatus?.pr?.state === "open" ? gitStatus.pr.url : null;
    if (!prUrl) {
      Alert.alert("No open PR", "This branch does not have an open pull request.");
      return;
    }
    if (!(await tryOpenExternalUrl(prUrl, "pull-request"))) {
      Alert.alert("Unable to open PR", "The pull request could not be opened.");
    }
  }, [gitStatus]);

  const runActionWithPrompt = useCallback(
    async (input: GitActionRequestInput) => {
      const confirmableAction =
        input.action === "push" ||
        input.action === "create_pr" ||
        input.action === "commit_push" ||
        input.action === "commit_push_pr"
          ? input.action
          : null;
      const branchName = gitStatus?.refName;
      if (
        branchName &&
        confirmableAction &&
        !input.featureBranch &&
        requiresDefaultBranchConfirmation(input.action, isDefaultRef)
      ) {
        navigation.navigate("GitConfirm", {
          environmentId: String(environmentId),
          threadId: String(threadId),
          confirmAction: confirmableAction,
          branchName,
          includesCommit: String(
            input.action === "commit_push" || input.action === "commit_push_pr",
          ),
        });
        return;
      }

      await onRunAction(input);
    },
    [environmentId, gitStatus, isDefaultRef, onRunAction, navigation, threadId],
  );

  const runQuickAction = useCallback(async () => {
    if (quickAction.kind === "open_pr") {
      await openExistingPr();
      return;
    }
    if (quickAction.kind === "run_pull") {
      await onPull();
      return;
    }
    if (quickAction.kind === "run_action" && quickAction.action) {
      await runActionWithPrompt({ action: quickAction.action });
    }
  }, [onPull, openExistingPr, quickAction, runActionWithPrompt]);

  const openFiles = useCallback(() => {
    if (props.onOpenFilesInspector) {
      props.onOpenFilesInspector();
      return;
    }
    navigation.navigate("ThreadFiles", {
      environmentId: String(environmentId),
      threadId: String(threadId),
    });
  }, [environmentId, props.onOpenFilesInspector, navigation, threadId]);

  const openReview = useCallback(() => {
    navigation.navigate("ThreadReview", {
      environmentId: EnvironmentId.make(String(environmentId)),
      threadId: ThreadId.make(String(threadId)),
    });
  }, [environmentId, navigation, threadId]);

  const openGitInspector = useCallback(() => {
    if (props.onOpenGitInspector) {
      props.onOpenGitInspector();
      return;
    }
    navigation.navigate("GitOverview", {
      environmentId: String(environmentId),
      threadId: String(threadId),
    });
  }, [environmentId, props.onOpenGitInspector, navigation, threadId]);

  return {
    currentBranchLabel,
    isRepo,
    openFiles,
    openGitInspector,
    openReview,
    quickAction,
    quickActionHint,
    quickActionIcon,
    runQuickAction,
  };
}

function useThreadGitHeaderActionItems(props: ThreadGitControlsProps): ThreadGitHeaderActionItems {
  const model = useThreadGitControlModel(props);

  return useMemo(
    () => ({
      inspector: props.inspectorControl
        ? {
            accessibilityLabel: props.inspectorControl.accessibilityLabel,
            // Native badges need iOS 26; the label carries the count everywhere.
            ...(props.inspectorControl.badgeCount > 0
              ? {
                  badge: {
                    value: props.inspectorControl.badgeCount,
                    style: {
                      backgroundColor: props.inspectorControl.badgeColors.fill,
                      color: props.inspectorControl.badgeColors.text,
                    },
                  },
                }
              : {}),
            icon: { name: "info.circle", type: "sfSymbol" },
            identifier: "thread-right-run-details",
            label: "Run details",
            onPress: props.inspectorControl.onPress,
            sharesBackground: true,
            type: "button",
            variant: "plain",
          }
        : null,
      terminal: {
        accessibilityLabel: "Open terminal",
        disabled: !props.canOpenTerminal,
        icon: { name: "terminal", type: "sfSymbol" },
        identifier: "thread-right-terminal",
        label: "Terminal",
        menu: {
          items: [
            ...props.projectScripts.map((script) => ({
              description: script.command,
              icon: { name: projectScriptMenuIcon(script.icon), type: "sfSymbol" as const },
              label: projectScriptMenuLabel(script),
              onPress: () => void props.onRunProjectScript(script),
              type: "action" as const,
            })),
            ...(props.projectScripts.length === 0
              ? [
                  {
                    description: "This project has no saved scripts yet",
                    disabled: true,
                    icon: { name: "play", type: "sfSymbol" as const },
                    label: "No project scripts",
                    onPress: () => {},
                    type: "action" as const,
                  },
                ]
              : []),
            ...props.terminalSessions.map((session) => ({
              description: [
                getTerminalStatusLabel({
                  status: session.status,
                  hasRunningSubprocess: session.hasRunningSubprocess,
                }),
                basename(session.cwd),
              ]
                .filter(Boolean)
                .join(" · "),
              icon: { name: "terminal", type: "sfSymbol" as const },
              label: session.displayLabel,
              onPress: () => props.onOpenTerminal(session.terminalId),
              type: "action" as const,
            })),
            {
              description: "Start another shell for this thread",
              icon: { name: "plus", type: "sfSymbol" },
              label: "Open new terminal",
              onPress: props.onOpenNewTerminal,
              type: "action",
            },
          ],
          title: "Terminal",
        },
        sharesBackground: true,
        type: "menu",
        variant: "plain",
      },
      files: {
        accessibilityLabel: "Open files",
        disabled: !props.canOpenFiles,
        icon: { name: "folder", type: "sfSymbol" },
        identifier: "thread-right-files",
        label: "Files",
        onPress: model.openFiles,
        sharesBackground: true,
        type: "button",
        variant: "plain",
      },
      git: {
        accessibilityLabel: "Git actions",
        icon: { name: "point.topleft.down.curvedto.point.bottomright.up", type: "sfSymbol" },
        identifier: "thread-right-git",
        label: "Git",
        menu: {
          items: [
            {
              description: compactMenuStatus(props.gitStatus),
              disabled: true,
              icon: {
                name: "point.topleft.down.curvedto.point.bottomright.up",
                type: "sfSymbol",
              },
              label: compactMenuBranchLabel(model.currentBranchLabel),
              onPress: (): void => {},
              type: "action",
            },
            {
              description: model.quickActionHint ?? undefined,
              disabled: model.quickAction.disabled,
              icon: { name: model.quickActionIcon, type: "sfSymbol" },
              label: model.quickAction.label,
              onPress: (): void => void model.runQuickAction(),
              type: "action",
            },
            {
              description: "Turn diffs and worktree changes",
              disabled: !model.isRepo,
              icon: { name: "text.bubble", type: "sfSymbol" },
              label: "Review changes",
              onPress: model.openReview,
              type: "action",
            },
            {
              description: "Commit, files, branches",
              icon: { name: "ellipsis", type: "sfSymbol" },
              label: "More",
              onPress: model.openGitInspector,
              type: "action",
            },
          ],
          title: "Git",
        },
        sharesBackground: true,
        type: "menu",
        variant: "plain",
      },
    }),
    [
      model.currentBranchLabel,
      model.isRepo,
      model.openFiles,
      model.openGitInspector,
      model.openReview,
      model.quickAction.disabled,
      model.quickAction.label,
      model.quickActionHint,
      model.quickActionIcon,
      model.runQuickAction,
      props.canOpenFiles,
      props.canOpenTerminal,
      props.gitStatus,
      props.inspectorControl,
      props.onOpenNewTerminal,
      props.onOpenTerminal,
      props.onRunProjectScript,
      props.projectScripts,
      props.terminalSessions,
    ],
  );
}

// The first right item sits at the trailing edge, so the Inspector leads both
// orders and stays visible when iOS collapses items that do not fit.
/** An entry the thread's options menu adds beside the git, files and terminal ones. */
export type ThreadOptionsMenuAction =
  | {
      readonly label: string;
      readonly description?: string;
      readonly icon?: string;
      readonly disabled?: boolean;
      readonly onPress: () => void;
    }
  | {
      readonly label: string;
      readonly icon?: string;
      readonly items: ReadonlyArray<ThreadOptionsMenuAction>;
    };

/**
 * Board 9's single "Thread options" button for a phone header: every action
 * the header used to show as its own icon (Run details, Files, Terminal,
 * Git), in one menu, after `leading` (the thread's context) and before
 * `trailing` ("Where was I?").
 */
export function useThreadOptionsHeaderItem(
  props: ThreadGitControlsProps,
  extra: {
    readonly leading: ReadonlyArray<ThreadOptionsMenuAction>;
    readonly trailing: ReadonlyArray<ThreadOptionsMenuAction>;
  },
): HeaderItem {
  const actionItems = useThreadGitHeaderActionItems(props);
  return useMemo(() => {
    const action = (entry: ThreadOptionsMenuAction): Record<string, unknown> =>
      "items" in entry
        ? {
            type: "submenu" as const,
            label: entry.label,
            ...(entry.icon ? { icon: { name: entry.icon, type: "sfSymbol" as const } } : {}),
            items: entry.items.map(action),
          }
        : {
            type: "action" as const,
            label: entry.label,
            ...(entry.description ? { description: entry.description } : {}),
            ...(entry.icon ? { icon: { name: entry.icon, type: "sfSymbol" as const } } : {}),
            disabled: entry.disabled === true,
            onPress: entry.onPress,
          };
    const submenu = (item: HeaderItem, label: string) => ({
      type: "submenu" as const,
      label,
      icon: item.icon,
      items: (item.menu as { readonly items: unknown[] }).items,
    });
    const inspector = props.inspectorControl;
    return {
      accessibilityLabel: "Thread options",
      icon: { name: "ellipsis", type: "sfSymbol" },
      identifier: "thread-right-options",
      label: "Thread options",
      menu: {
        items: [
          ...extra.leading.map(action),
          ...(inspector
            ? [
                action({
                  label: "Run details",
                  ...(inspector.badgeCount > 0
                    ? {
                        description: `${inspector.badgeCount} ${
                          inspector.badgeCount === 1 ? "subagent" : "subagents"
                        } running`,
                      }
                    : {}),
                  icon: "info.circle",
                  onPress: inspector.onPress,
                }),
              ]
            : []),
          action({
            label: "Files",
            icon: "folder",
            disabled: !props.canOpenFiles,
            onPress: actionItems.files.onPress as () => void,
          }),
          submenu(actionItems.terminal, "Terminal"),
          submenu(actionItems.git, "Git"),
          ...extra.trailing.map(action),
        ],
        title: "",
      },
      sharesBackground: true,
      type: "menu",
      variant: "plain",
    };
  }, [actionItems, extra.leading, extra.trailing, props.canOpenFiles, props.inspectorControl]);
}

export function useThreadGitCenterHeaderItems(props: ThreadGitControlsProps): HeaderItems {
  const actionItems = useThreadGitHeaderActionItems(props);
  return useMemo(
    () =>
      [
        ...(actionItems.inspector ? [actionItems.inspector] : []),
        actionItems.files,
        actionItems.git,
        actionItems.terminal,
      ] as HeaderItems,
    [actionItems],
  );
}

export function ThreadGitMenu(props: ThreadGitMenuProps) {
  const menu = useThreadGitMenuDefinition(props);
  return menu ? createNativeHeaderMenu(menu) : null;
}

/** Returns menu data because native toolbars serialize direct items rather than rendering component children. */
export function useThreadGitMenuDefinition(props: ThreadGitMenuProps): ScreenHeaderMenu | null {
  return threadGitMenuDefinition(props, useThreadGitControlModel(props));
}

function threadGitMenuDefinition(
  props: ThreadGitMenuProps,
  model: ReturnType<typeof useThreadGitControlModel>,
): ScreenHeaderMenu {
  return {
    title: "Git controls",
    icon: "point.topleft.down.curvedto.point.bottomright.up",
    separateBackground: false,
    items: [
      {
        id: "git-status",
        title: compactMenuBranchLabel(model.currentBranchLabel),
        icon: "point.topleft.down.curvedto.point.bottomright.up",
        disabled: true,
        subtitle: compactMenuStatus(props.gitStatus),
        onPress: () => {},
      },
      {
        id: "git-quick-action",
        title: model.quickAction.label,
        icon: model.quickActionIcon,
        disabled: model.quickAction.disabled,
        subtitle: model.quickActionHint ?? undefined,
        onPress: () => {
          void model.runQuickAction();
        },
      },
      {
        id: "git-review",
        title: "Review changes",
        icon: "text.bubble",
        disabled: !model.isRepo,
        subtitle: "Turn diffs and worktree changes",
        onPress: model.openReview,
      },
      {
        id: "git-more",
        title: "More",
        icon: "ellipsis",
        subtitle: "Commit, files, branches",
        onPress: model.openGitInspector,
      },
    ],
  };
}
