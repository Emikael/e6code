import type { PreviewAnnotationPayload } from "@e6tools/contracts";

import type { ReviewCommentContext } from "~/reviewCommentContext";

import {
  isPullRequestSummaryContext,
  previewAnnotationContextLabel,
  reviewCommentContextLabel,
  terminalContextReference,
} from "./composerContextRecords";
import type { TerminalContextDraft } from "./terminalContext";

/**
 * F22: Diff comments, file comments, terminal output and browser notes are one thing, context
 * attached to the next message. The composer draft holds all of it; this is how every surface
 * names and counts it. The word is "attached": "queued" means a follow-up waiting for a busy agent.
 */
export type AttachedKind = "comment" | "note" | "terminal";

/** Said on every surface that attaches context to the next message. */
export const ATTACHED_SENTENCE = "Attached. Goes with your next message in this thread.";
/** A browser note carries the screenshot captured when it was made. */
export const ATTACHED_WITH_SCREENSHOT_SENTENCE =
  "Attached with a screenshot of this area. Goes with your next message in this thread.";

export interface AttachedItem {
  readonly kind: AttachedKind;
  /** The draft record's id, which its remove action takes. */
  readonly id: string;
  readonly label: string;
}

export interface AttachedGroup {
  readonly kind: AttachedKind;
  readonly title: string;
  readonly items: ReadonlyArray<AttachedItem>;
}

export interface AttachedDraft {
  readonly reviewComments: ReadonlyArray<ReviewCommentContext>;
  readonly previewAnnotations: ReadonlyArray<PreviewAnnotationPayload>;
  readonly terminalContexts: ReadonlyArray<TerminalContextDraft>;
}

const GROUP_TITLES: Record<AttachedKind, string> = {
  comment: "Comments",
  note: "Browser notes",
  terminal: "Terminal output",
};

/**
 * Comments on this thread's code that have not been sent: Diff and file comments alike. A pull
 * request's review threads handed to the agent are its own request, not the reader's comments,
 * so they stay inline in the prompt and are not counted.
 */
function unsentCodeComments(
  comments: ReadonlyArray<ReviewCommentContext>,
): ReadonlyArray<ReviewCommentContext> {
  return comments.filter((comment) => !isPullRequestSummaryContext(comment));
}

/** "Note 2": a browser note's number, the same on its card and in the composer. */
export function browserNoteTitle(index: number): string {
  return `Note ${(index + 1).toLocaleString()}`;
}

/**
 * Everything attached to the draft, grouped by kind in a fixed order; empty groups left out.
 * This is the one definition of "attached": every count on every surface is taken from it.
 */
export function attachedGroups(draft: AttachedDraft | null | undefined): AttachedGroup[] {
  if (!draft) return [];
  const groups: AttachedGroup[] = [
    {
      kind: "comment",
      title: GROUP_TITLES.comment,
      items: unsentCodeComments(draft.reviewComments).map((comment) => ({
        kind: "comment",
        id: comment.id,
        label: reviewCommentContextLabel(comment),
      })),
    },
    {
      kind: "note",
      title: GROUP_TITLES.note,
      items: draft.previewAnnotations.map((annotation, index) => ({
        kind: "note",
        id: annotation.id,
        label: `${browserNoteTitle(index)} · ${previewAnnotationContextLabel(annotation)}`,
      })),
    },
    {
      kind: "terminal",
      title: GROUP_TITLES.terminal,
      items: draft.terminalContexts.map((context) => ({
        kind: "terminal",
        id: context.id,
        label: terminalContextReference(context).label,
      })),
    },
  ];
  return groups.filter((group) => group.items.length > 0);
}

const ATTACHED_KINDS: ReadonlyArray<AttachedKind> = ["comment", "note", "terminal"];

const NOUNS: Record<AttachedKind, readonly [string, string]> = {
  comment: ["comment", "comments"],
  note: ["note", "notes"],
  terminal: ["selection", "selections"],
};

/** "1 comment", "2 notes": a count of one kind, the words every attached label is built from. */
export function attachedCountNoun(count: number, kind: AttachedKind): string {
  const [one, many] = NOUNS[kind];
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** "1 comment attached", "2 notes attached". */
export function attachedCountLabel(count: number, kind: AttachedKind): string {
  return `${attachedCountNoun(count, kind)} attached`;
}

/** Diff and file comments attached and not sent: the Diff, Files and Run details count. */
export function unsentCodeCommentCount(comments: ReadonlyArray<ReviewCommentContext>): number {
  return unsentCodeComments(comments).length;
}

/** How many items of one kind are attached to the draft: a tab's count. */
export function attachedCount(draft: AttachedDraft | null | undefined, kind: AttachedKind): number {
  if (!draft) return 0;
  switch (kind) {
    case "comment":
      return unsentCodeCommentCount(draft.reviewComments);
    case "note":
      return draft.previewAnnotations.length;
    case "terminal":
      return draft.terminalContexts.length;
  }
}

/**
 * "1 comment not sent", "2 comments and 1 note not sent": what a thread's sidebar row and its
 * recap say while items wait in its composer. Null when nothing is attached.
 */
export function attachedNotSentLabel(draft: AttachedDraft | null | undefined): string | null {
  // Counted, not grouped: sidebar rows read this on every composer change.
  const parts = ATTACHED_KINDS.flatMap((kind) => {
    const count = attachedCount(draft, kind);
    return count === 0 ? [] : [attachedCountNoun(count, kind)];
  });
  if (parts.length === 0) return null;
  const last = parts.pop()!;
  return `${parts.length > 0 ? `${parts.join(", ")} and ${last}` : last} not sent`;
}
