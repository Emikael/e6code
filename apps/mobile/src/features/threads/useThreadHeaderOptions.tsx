import { StackActions, useNavigation } from "@react-navigation/native";
import { useMemo } from "react";
import type { AppNativeStackNavigationOptions } from "../../native/StackHeader";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import {
  type ThreadGitControlsProps,
  type ThreadOptionsMenuAction,
  useThreadGitCenterHeaderItems,
  useThreadOptionsHeaderItem,
} from "./ThreadGitControls";

type NativeHeaderItems = ReadonlyArray<Record<string, unknown>>;

export function useThreadHeaderOptions(props: {
  readonly title: string;
  readonly subtitle: string;
  readonly headerColor: string;
  readonly usesNativeHeaderGlass: boolean;
  readonly gitControls: ThreadGitControlsProps;
  readonly onReturnToThread?: () => void;
  /** The phone header's "Thread options" menu around the git, files and terminal entries. */
  readonly threadOptions: {
    readonly leading: ReadonlyArray<ThreadOptionsMenuAction>;
    readonly trailing: ReadonlyArray<ThreadOptionsMenuAction>;
  };
}) {
  const navigation = useNavigation();
  const { layout, panes, togglePrimarySidebar } = useAdaptiveWorkspaceLayout();
  const threadCenterHeaderItems = useThreadGitCenterHeaderItems(props.gitControls);
  // Board 9: a phone header holds the title and one "…" button.
  const threadOptionsItem = useThreadOptionsHeaderItem(props.gitControls, props.threadOptions);
  const splitLeftHeaderItems = useMemo<NativeHeaderItems>(
    () => [
      {
        // Match Mail's split-view detail toolbar: the first detail action sits
        // inside the content pane, not flush against the sidebar divider.
        spacing: 18,
        type: "spacing" as const,
      },
      ...(props.onReturnToThread
        ? [
            withNativeGlassHeaderItem({
              accessibilityLabel: "Return to chat",
              icon: { name: "chevron.left", type: "sfSymbol" as const },
              identifier: "thread-left-return",
              onPress: props.onReturnToThread,
              type: "button" as const,
            }),
          ]
        : []),
      withNativeGlassHeaderItem({
        accessibilityLabel: panes.primarySidebarVisible
          ? "Maximize content"
          : "Show thread sidebar",
        icon: {
          name: panes.primarySidebarVisible ? "arrow.up.left.and.arrow.down.right" : "sidebar.left",
          type: "sfSymbol" as const,
        },
        identifier: "thread-left-sidebar",
        onPress: togglePrimarySidebar,
        type: "button" as const,
      }),
      withNativeGlassHeaderItem({
        accessibilityLabel: "New task",
        icon: { name: "square.and.pencil", type: "sfSymbol" as const },
        identifier: "thread-left-new-task",
        onPress: () => navigation.navigate("NewTaskSheet", { screen: "NewTask" }),
        type: "button" as const,
      }),
    ],
    [panes.primarySidebarVisible, props.onReturnToThread, navigation, togglePrimarySidebar],
  );
  // Deep links / cold starts land with Thread as the ONLY route, where the
  // native back button does not render. Provide an explicit Home escape for
  // that case; when history exists the native back button is used instead.
  const canGoBack = navigation.canGoBack();
  const compactHomeHeaderItems = useMemo<NativeHeaderItems>(
    () => [
      withNativeGlassHeaderItem({
        accessibilityLabel: "Go to threads list",
        icon: { name: "list.bullet", type: "sfSymbol" as const },
        identifier: "thread-left-home",
        onPress: () => navigation.dispatch(StackActions.replace("Home")),
        type: "button" as const,
      }),
    ],
    [navigation],
  );

  const options: AppNativeStackNavigationOptions = {
    headerShown: true,
    headerTitle: props.title,
    headerTitleStyle: props.usesNativeHeaderGlass
      ? {
          fontSize: 17,
          fontWeight: "800",
        }
      : undefined,
    title: props.title,
    headerBackVisible: !layout.usesSplitView,
    // Compact uses the NATIVE back button when a previous route exists;
    // deep links / cold starts get an explicit Home button instead.
    // Split view always uses its custom left items.
    unstable_headerLeftItems: layout.usesSplitView
      ? () => splitLeftHeaderItems
      : canGoBack
        ? undefined
        : () => compactHomeHeaderItems,
    // Search lives in the persistent sidebar, so the split header keeps
    // the git controls on the RIGHT (no center items — center space is
    // reserved for future breadcrumbs/status).
    unstable_headerRightItems: () =>
      layout.usesSplitView ? threadCenterHeaderItems : [threadOptionsItem],
    // A phone shows the title alone; its context leads the options menu.
    unstable_headerSubtitle:
      props.usesNativeHeaderGlass && layout.usesSplitView ? props.subtitle : undefined,
    contentStyle: undefined,
  };
  return {
    options,
    sidebar: false,
    fallback: null,
  };
}
