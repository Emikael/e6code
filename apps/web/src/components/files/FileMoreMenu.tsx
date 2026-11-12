import type { EditorId, EnvironmentId, ResolvedKeybindingsConfig } from "@e6tools/contracts";
import { MoreHorizontalIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { OpenInPicker } from "~/components/chat/OpenInPicker";

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
 * The file header's More menu (board 15): Wrap, Open in editor, Open in Browser, Copy path and
 * Keep as its own tab. Each item is left out where it does not apply, and `children` adds the
 * file's own commands, such as Revert my edits, at the end.
 */
export function FileMoreMenu(props: {
  readonly wordWrap: boolean | null;
  readonly onWordWrapChange: (wordWrap: boolean) => void;
  readonly editor: {
    readonly environmentId: EnvironmentId;
    readonly keybindings: ResolvedKeybindingsConfig;
    readonly availableEditors: ReadonlyArray<EditorId>;
    readonly absolutePath: string;
  } | null;
  readonly onOpenInBrowser: (() => void) | null;
  readonly onCopyPath: (() => void) | null;
  readonly onKeepAsTab: (() => void) | null;
  readonly children?: ReactNode;
}) {
  const sections = [
    props.wordWrap === null ? null : (
      <MenuCheckboxItem
        key="wrap"
        checked={props.wordWrap}
        onCheckedChange={(checked) => props.onWordWrapChange(Boolean(checked))}
      >
        Wrap
      </MenuCheckboxItem>
    ),
    props.editor || props.onOpenInBrowser ? (
      <Fragment key="open">
        {props.editor ? (
          <OpenInPicker
            environmentId={props.editor.environmentId}
            keybindings={props.editor.keybindings}
            availableEditors={props.editor.availableEditors}
            openInCwd={props.editor.absolutePath}
            presentation="menu"
            menuDensity="default"
            enableShortcut={false}
          />
        ) : null}
        {props.onOpenInBrowser ? (
          <MenuItem onClick={props.onOpenInBrowser}>Open in Browser</MenuItem>
        ) : null}
      </Fragment>
    ) : null,
    props.onCopyPath || props.onKeepAsTab ? (
      <Fragment key="path">
        {props.onCopyPath ? <MenuItem onClick={props.onCopyPath}>Copy path</MenuItem> : null}
        {props.onKeepAsTab ? (
          <MenuItem onClick={props.onKeepAsTab}>Keep as its own tab</MenuItem>
        ) : null}
      </Fragment>
    ) : null,
    props.children ? <Fragment key="file">{props.children}</Fragment> : null,
  ].filter((section) => section !== null);
  if (sections.length === 0) return null;
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="More: wrap, open in editor, copy path, keep as its own tab"
          />
        }
      >
        <MoreHorizontalIcon aria-hidden className="size-4" />
      </MenuTrigger>
      <MenuPopup align="end" className="min-w-52">
        {sections.flatMap((section, index) =>
          index === 0 ? [section] : [<MenuSeparator key={`separator-${section.key}`} />, section],
        )}
      </MenuPopup>
    </Menu>
  );
}
