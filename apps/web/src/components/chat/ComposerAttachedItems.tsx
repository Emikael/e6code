import { MessageSquareIcon, MousePointerClickIcon, TerminalIcon, XIcon } from "lucide-react";
import { useMemo } from "react";

import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";
import { type AttachedItem, type AttachedKind, attachedGroups } from "~/lib/attachedForAgent";

import { Button } from "../ui/button";

const KIND_ICONS: Record<AttachedKind, typeof MessageSquareIcon> = {
  comment: MessageSquareIcon,
  note: MousePointerClickIcon,
  terminal: TerminalIcon,
};

/**
 * F22: the composer is the one ledger of what is attached to the next message. Diff and file
 * comments, browser notes and terminal output show here grouped by kind, each removable, so
 * nothing rides along with an unrelated message unseen. Removing one also removes its reference
 * from the prompt. Renders nothing while nothing is attached.
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
  if (groups.length === 0) return null;

  const remove = (item: AttachedItem) => {
    const store = useComposerDraftStore.getState();
    if (item.kind === "comment") store.removeReviewComment(props.target, item.id);
    else if (item.kind === "note") store.removePreviewAnnotation(props.target, item.id);
    else store.removeTerminalContext(props.target, item.id);
  };

  return (
    <div role="group" aria-label="Attached to this message" className="mb-2 flex flex-col gap-1">
      {groups.map((group) => {
        const Icon = KIND_ICONS[group.kind];
        return (
          <div key={group.kind} className="flex min-w-0 flex-wrap items-center gap-1">
            <span className="me-1 shrink-0 text-muted-foreground text-xs">{group.title}</span>
            {group.items.map((item) => (
              <span
                key={item.id}
                className="inline-flex h-6 min-w-0 max-w-64 items-center gap-1 rounded-md border border-border bg-background ps-1.5 text-foreground text-xs"
              >
                <Icon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{item.label}</span>
                <Button
                  variant="ghost"
                  size="icon-micro"
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
