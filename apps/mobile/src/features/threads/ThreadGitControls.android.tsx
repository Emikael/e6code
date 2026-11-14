import type {
  ThreadGitControlsProps,
  ThreadGitMenu as IosThreadGitMenu,
  useThreadGitCenterHeaderItems as useIosThreadGitCenterHeaderItems,
} from "./ThreadGitControls";

export type { ThreadGitControlsProps, ThreadGitMenuProps } from "./ThreadGitControls";

const EMPTY_HEADER_ITEMS: ReturnType<typeof useIosThreadGitCenterHeaderItems> = [];

export function useThreadGitCenterHeaderItems(_props: ThreadGitControlsProps) {
  return EMPTY_HEADER_ITEMS;
}

export function ThreadGitMenu(_props: Parameters<typeof IosThreadGitMenu>[0]) {
  return null;
}

export function useThreadGitMenuDefinition(_props: Parameters<typeof IosThreadGitMenu>[0]) {
  return null;
}
