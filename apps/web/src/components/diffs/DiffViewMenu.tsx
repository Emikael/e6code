import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";

/**
 * The Diff header's one View menu: Wrap and Hide whitespace (both saved settings, shared with
 * every diff and, for Wrap, file previews), Expand all, Collapse all and Refresh. `children`
 * adds surface-specific items at the end.
 */
export function DiffViewMenu({
  wordWrap,
  onWordWrapChange,
  ignoreWhitespace,
  onIgnoreWhitespaceChange,
  fileCount,
  allCollapsed,
  noneCollapsed,
  onExpandAll,
  onCollapseAll,
  onRefresh,
  refreshing = false,
  children,
}: {
  wordWrap: boolean;
  onWordWrapChange: (wordWrap: boolean) => void;
  ignoreWhitespace: boolean;
  onIgnoreWhitespaceChange: (ignoreWhitespace: boolean) => void;
  fileCount: number;
  allCollapsed: boolean;
  noneCollapsed: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  /** Absent where the diff cannot be refreshed, such as a finished turn. */
  onRefresh?: (() => void) | undefined;
  refreshing?: boolean;
  children?: ReactNode;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="compact"
            variant="ghost"
            aria-label="View options: wrap, whitespace, expand all, refresh"
          />
        }
      >
        View
        <ChevronDownIcon aria-hidden className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end" className="min-w-48">
        <MenuCheckboxItem
          checked={wordWrap}
          onCheckedChange={(checked) => onWordWrapChange(Boolean(checked))}
        >
          Wrap
        </MenuCheckboxItem>
        <MenuCheckboxItem
          checked={ignoreWhitespace}
          onCheckedChange={(checked) => onIgnoreWhitespaceChange(Boolean(checked))}
        >
          Hide whitespace
        </MenuCheckboxItem>
        <MenuSeparator />
        <MenuItem disabled={fileCount === 0 || noneCollapsed} onClick={onExpandAll}>
          Expand all
        </MenuItem>
        <MenuItem disabled={fileCount === 0 || allCollapsed} onClick={onCollapseAll}>
          Collapse all
        </MenuItem>
        {onRefresh ? (
          <>
            <MenuSeparator />
            <MenuItem disabled={refreshing} onClick={onRefresh}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </MenuItem>
          </>
        ) : null}
        {children}
      </MenuPopup>
    </Menu>
  );
}
