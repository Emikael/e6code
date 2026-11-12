import { MessageSquareIcon, MousePointerClickIcon, TerminalIcon, XIcon } from "lucide-react";
import { useId, useMemo, useRef } from "react";

import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";
import { type AttachedItem, type AttachedKind, attachedGroups } from "~/lib/attachedForAgent";
import { dispatchSnapShotComposerFocus } from "~/lib/desktopSnapShot";

import { Button } from "../ui/button";

const KIND_ICONS: Record<AttachedKind, typeof MessageSquareIcon> = {
  comment: MessageSquareIcon,
  note: MousePointerClickIcon,
  terminal: TerminalIcon,
};

/**
 * F22: the composer is the one ledger of what is attached to the next message. Diff and file
 * comments, browser notes and terminal output show here, and only here, grouped by kind, each
 * removable, so nothing rides along with an unrelated message unseen. Their references stay in
 * the prompt, which is what the send path reads, but the editor does not draw them (see
 * `attachedItemsShownElsewhere`). Removing one also removes its reference. Renders nothing while
 * nothing is attached.
 */
export function ComposerAttachedItems(props: { readonly target: ComposerThreadTarget }) {
  const draft = useComposerDraftStore((store) => store.getComposerDraft(props.target));
  const reviewComments = draft?.reviewComments;
  const previewAnnotations = draft?.previewAnnotations;
  const terminalContexts = draft?.terminalContexts;
  const groups = useMemo(
    () =>
      reviewComments && previewAnnotations && terminalContexts
        ? attachedGroups({ reviewComments, previewAnnotations, terminalContexts })
        : [],
    [previewAnnotations, reviewComments, terminalContexts],
  );
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const idPrefix = useId();
  if (groups.length === 0) return null;

  const items = groups.flatMap((group) => group.items);
  const remove = (item: AttachedItem) => {
    // Focus moves before the chip goes, so it never falls back to the page: to the next chip,
    // else the previous one, else the editor.
    const index = items.findIndex((candidate) => candidate.id === item.id);
    const neighbour = items[index + 1] ?? items[index - 1];
    const neighbourButton = neighbour ? removeButtons.current.get(neighbour.id) : undefined;
    if (neighbourButton) neighbourButton.focus();
    else dispatchSnapShotComposerFocus();
    const store = useComposerDraftStore.getState();
    if (item.kind === "comment") store.removeReviewComment(props.target, item.id);
    else if (item.kind === "note") store.removePreviewAnnotation(props.target, item.id);
    else store.removeTerminalContext(props.target, item.id);
  };

  return (
    // About two rows of chips; more scroll inside rather than grow the composer.
    <div
      role="group"
      aria-labelledby={`${idPrefix}-attached`}
      className="mb-2 flex max-h-[60px] min-w-0 flex-wrap items-center gap-x-2 gap-y-1 overflow-y-auto"
    >
      <span id={`${idPrefix}-attached`} className="shrink-0 font-medium text-foreground text-xs">
        Attached
      </span>
      {groups.map((group) => {
        const Icon = KIND_ICONS[group.kind];
        const titleId = `${idPrefix}-${group.kind}`;
        return (
          <div
            key={group.kind}
            role="group"
            aria-labelledby={titleId}
            className="flex min-w-0 flex-wrap items-center gap-1"
          >
            <span id={titleId} className="me-1 shrink-0 text-muted-foreground text-xs">
              {group.title}
            </span>
            {group.items.map((item) => (
              <span
                key={item.id}
                className="inline-flex min-w-0 max-w-64 items-center gap-1 rounded-md border border-border bg-background ps-1.5 text-foreground text-xs"
              >
                <Icon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{item.label}</span>
                <Button
                  ref={(element) => {
                    if (element) removeButtons.current.set(item.id, element);
                    else removeButtons.current.delete(item.id);
                  }}
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${item.label}`}
                  onClick={() => remove(item)}
                >
                  <XIcon />
                </Button>
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}
