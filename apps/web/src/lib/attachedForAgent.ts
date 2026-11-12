import type { PreviewAnnotationPayload } from "@e6tools/contracts";

import type { ReviewCommentContext } from "~/reviewCommentContext";

import {
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

interface AttachedDraft {
  readonly reviewComments: ReadonlyArray<ReviewCommentContext>;
  readonly previewAnnotations: ReadonlyArray<PreviewAnnotationPayload>;
  readonly terminalContexts: ReadonlyArray<TerminalContextDraft>;
}

const GROUP_TITLES: Record<AttachedKind, string> = {
  comment: "Comments",
  note: "Browser notes",
  terminal: "Terminal output",
};

/** Everything attached to the draft, grouped by kind in a fixed order; empty groups left out. */
export function attachedGroups(draft: AttachedDraft | null): AttachedGroup[] {
  if (draft === null) return [];
  const groups: AttachedGroup[] = [
    {
      kind: "comment",
      title: GROUP_TITLES.comment,
      items: draft.reviewComments.map((comment) => ({
        kind: "comment",
        id: comment.id,
        label: reviewCommentContextLabel(comment),
      })),
    },
    {
      kind: "note",
      title: GROUP_TITLES.note,
      items: draft.previewAnnotations.map((annotation) => ({
        kind: "note",
        id: annotation.id,
        label: previewAnnotationContextLabel(annotation),
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

const NOUNS: Record<AttachedKind, readonly [string, string]> = {
  comment: ["comment", "comments"],
  note: ["note", "notes"],
  terminal: ["selection", "selections"],
};

/** "1 comment attached", "2 notes attached". */
export function attachedCountLabel(count: number, kind: AttachedKind): string {
  const [one, many] = NOUNS[kind];
  return `${count.toLocaleString()} ${count === 1 ? one : many} attached`;
}

/**
 * Comments on this thread's code that have not been sent: Diff and file comments alike. A pull
 * request's review threads handed to the agent are its own request, not the reader's comments.
 */
export function unsentCodeCommentCount(comments: ReadonlyArray<ReviewCommentContext>): number {
  return comments.filter((comment) => !comment.pullRequest).length;
}

/** The comments attached on one open file in the Files tab. */
export function fileCommentCount(
  comments: ReadonlyArray<ReviewCommentContext>,
  relativePath: string,
): number {
  const sectionId = `file:${relativePath}`;
  return comments.filter((comment) => comment.sectionId === sectionId).length;
}
