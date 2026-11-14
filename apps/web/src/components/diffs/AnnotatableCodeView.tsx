import type {
  AnnotationSide,
  CodeViewDiffItem,
  CodeViewItem,
  DiffLineAnnotation,
  FileDiffMetadata,
  SelectedLineRange,
} from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import type { ScopedThreadRef } from "@e6tools/contracts";
import { useCallback, useEffect, useMemo, useState, type ReactNode, type Ref } from "react";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { fnv1a32 } from "~/lib/diffRendering";
import {
  buildDiffReviewComment,
  restoreDiffReviewCommentRange,
  type ReviewCommentContext,
} from "~/reviewCommentContext";

import { nextFileCommentId } from "../files/fileCommentAnnotations";
import { DiffCommentAnnotation } from "./DiffCommentAnnotation";
import { StyledDiffCodeView, type StyledDiffCodeViewOptions } from "./StyledDiffCodeView";

interface DiffCommentAnnotationEntry {
  id: string;
  kind: "draft" | "comment";
  range: SelectedLineRange;
  rangeLabel: string;
  text: string;
}

interface DiffCommentAnnotationGroup {
  entries: DiffCommentAnnotationEntry[];
  /** "You stopped here at 14:06", drawn as a hairline under the line. */
  marker?: string;
}

/** A hairline with words under one line of one file, such as where the reader stopped. */
export interface DiffLineMarker {
  readonly fileKey: string;
  readonly side: AnnotationSide;
  readonly lineNumber: number;
  readonly label: string;
}

function withMarker(
  annotations: ReadonlyArray<DiffCommentLineAnnotation>,
  marker: DiffLineMarker,
): DiffCommentLineAnnotation[] {
  const index = annotations.findIndex(
    (annotation) => annotation.side === marker.side && annotation.lineNumber === marker.lineNumber,
  );
  if (index < 0) {
    return [
      ...annotations,
      {
        side: marker.side,
        lineNumber: marker.lineNumber,
        metadata: { entries: [], marker: marker.label },
      },
    ];
  }
  return annotations.map((annotation, at) =>
    at === index
      ? { ...annotation, metadata: { ...annotation.metadata, marker: marker.label } }
      : annotation,
  );
}

type DiffCommentLineAnnotation = DiffLineAnnotation<DiffCommentAnnotationGroup>;
export type AnnotatableCodeViewHandle = CodeViewHandle<DiffCommentAnnotationGroup>;
const EMPTY_REVIEW_COMMENTS: ReadonlyArray<ReviewCommentContext> = [];

function annotationSide(range: SelectedLineRange): AnnotationSide {
  return (range.endSide ?? range.side) === "deletions" ? "deletions" : "additions";
}

function appendAnnotationEntry(
  annotations: ReadonlyArray<DiffCommentLineAnnotation>,
  range: SelectedLineRange,
  entry: DiffCommentAnnotationEntry,
): DiffCommentLineAnnotation[] {
  const side = annotationSide(range);
  const annotationIndex = annotations.findIndex(
    (annotation) => annotation.side === side && annotation.lineNumber === range.end,
  );
  if (annotationIndex < 0) {
    return [
      ...annotations,
      {
        side,
        lineNumber: range.end,
        metadata: { entries: [entry] },
      },
    ];
  }
  return annotations.map((annotation, index) =>
    index === annotationIndex
      ? {
          ...annotation,
          metadata: { entries: [...annotation.metadata.entries, entry] },
        }
      : annotation,
  );
}

interface AnnotatableCodeViewProps {
  codeViewKey: string;
  files: ReadonlyArray<{
    fileDiff: FileDiffMetadata;
    filePath: string;
    fileKey: string;
    fileVersion: number;
    collapsed: boolean;
  }>;
  sectionId: string;
  sectionTitle: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
  options: StyledDiffCodeViewOptions<DiffCommentAnnotationGroup>;
  viewerRef?: Ref<AnnotatableCodeViewHandle>;
  className?: string;
  renderCodeViewFooter?: () => ReactNode;
  unsafeCSSExtra?: string;
  /** Draws each file's whole header; its height is `headerHeight`. */
  renderCustomHeader: (
    fileDiff: FileDiffMetadata,
    fileKey: string,
    collapsed: boolean,
  ) => ReactNode;
  headerHeight: number;
  marker?: DiffLineMarker | null;
  onScroll?: (
    scrollTop: number,
    viewer: NonNullable<ReturnType<AnnotatableCodeViewHandle["getInstance"]>>,
  ) => void;
  /** Told whether a comment draft is open, which takes the screen's fill (`panelFill.ts`). */
  onCommentDraftOpenChange?: (open: boolean) => void;
}

interface DiffSelectionContext {
  item: CodeViewItem<DiffCommentAnnotationGroup>;
}

export function AnnotatableCodeView({
  codeViewKey,
  files,
  sectionId,
  sectionTitle,
  composerDraftTarget,
  options,
  viewerRef,
  className,
  renderCodeViewFooter,
  unsafeCSSExtra,
  renderCustomHeader,
  headerHeight,
  marker = null,
  onScroll,
  onCommentDraftOpenChange,
}: AnnotatableCodeViewProps) {
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const removeReviewComment = useComposerDraftStore((store) => store.removeReviewComment);
  const reviewComments = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.reviewComments ?? EMPTY_REVIEW_COMMENTS,
  );
  const [selectedLines, setSelectedLines] = useState<{
    id: string;
    range: SelectedLineRange;
  } | null>(null);
  const [draft, setDraft] = useState<{
    fileKey: string;
    annotation: DiffCommentLineAnnotation;
  } | null>(null);
  const [draftText, setDraftText] = useState("");

  const filesByKey = useMemo(() => new Map(files.map((file) => [file.fileKey, file])), [files]);
  const draftIds = useMemo(
    () => new Set(draft?.annotation.metadata.entries.map((entry) => entry.id) ?? []),
    [draft],
  );
  const items = useMemo<CodeViewDiffItem<DiffCommentAnnotationGroup>[]>(
    () =>
      files.map(({ fileDiff, filePath, fileKey, fileVersion, collapsed }) => {
        const persisted = reviewComments
          .filter(
            (comment) =>
              // A comment being edited shows as its draft instead.
              !draftIds.has(comment.id) &&
              comment.sectionId === sectionId &&
              comment.filePath === filePath &&
              (comment.fenceLanguage ?? "diff") === "diff",
          )
          .reduce<DiffCommentLineAnnotation[]>((annotations, comment) => {
            const range = restoreDiffReviewCommentRange(fileDiff, comment);
            if (!range) return annotations;
            return appendAnnotationEntry(annotations, range, {
              id: comment.id,
              kind: "comment",
              range,
              rangeLabel: comment.rangeLabel,
              text: comment.text,
            });
          }, []);
        const withDraft = draft?.fileKey === fileKey ? [...persisted, draft.annotation] : persisted;
        const annotations = marker?.fileKey === fileKey ? withMarker(withDraft, marker) : withDraft;
        return {
          id: fileKey,
          type: "diff",
          fileDiff,
          annotations,
          collapsed,
          version: fnv1a32(
            `${fileVersion}:${collapsed ? "1" : "0"}:${marker?.fileKey === fileKey ? `${marker.side}${marker.lineNumber}${marker.label}` : ""}:${annotations
              .flatMap((annotation) =>
                annotation.metadata.entries.map(
                  (entry) => `${entry.id}:${entry.rangeLabel}:${entry.text}`,
                ),
              )
              .join(":")}`,
          ),
        };
      }),
    [draft, draftIds, files, marker, reviewComments, sectionId],
  );

  const removeEntry = useCallback(
    (entryId: string) => {
      setSelectedLines(null);
      if (draft?.annotation.metadata.entries.some((entry) => entry.id === entryId)) {
        setDraft(null);
        setDraftText("");
      } else {
        removeReviewComment(composerDraftTarget, entryId);
      }
    },
    [composerDraftTarget, draft, removeReviewComment],
  );

  const submitEntry = useCallback(
    (entryId: string, text: string) => {
      const entry = draft?.annotation.metadata.entries.find(
        (candidate) => candidate.id === entryId,
      );
      const file = draft ? filesByKey.get(draft.fileKey) : undefined;
      if (!entry || !file) return;
      const comment = buildDiffReviewComment({
        id: entry.id,
        sectionId,
        sectionTitle,
        filePath: file.filePath,
        fileDiff: file.fileDiff,
        range: entry.range,
        text,
      });
      if (comment) addReviewComment(composerDraftTarget, comment);
      setSelectedLines(null);
      setDraft(null);
      setDraftText("");
    },
    [addReviewComment, composerDraftTarget, draft, filesByKey, sectionId, sectionTitle],
  );

  const beginComment = useCallback(
    (range: SelectedLineRange | null, context: DiffSelectionContext) => {
      if (!range) return;
      const item = context.item;
      if (item.type !== "diff") return;
      const file = filesByKey.get(item.id);
      if (!file) return;
      const id = nextFileCommentId();
      const comment = buildDiffReviewComment({
        id,
        sectionId,
        sectionTitle,
        filePath: file.filePath,
        fileDiff: file.fileDiff,
        range,
        text: "",
      });
      if (!comment) return;
      setDraftText("");
      setDraft({
        fileKey: item.id,
        annotation: {
          side: annotationSide(range),
          lineNumber: range.end,
          metadata: {
            entries: [{ id, kind: "draft", range, rangeLabel: comment.rangeLabel, text: "" }],
          },
        },
      });
    },
    [filesByKey, sectionId, sectionTitle],
  );

  // Edit reopens a saved comment as a draft under the same id; saving it replaces the comment in
  // the composer, and cancelling leaves the saved one as it was.
  const editEntry = useCallback((fileKey: string, entry: DiffCommentAnnotationEntry) => {
    setSelectedLines(null);
    setDraftText(entry.text);
    setDraft({
      fileKey,
      annotation: {
        side: annotationSide(entry.range),
        lineNumber: entry.range.end,
        metadata: { entries: [{ ...entry, kind: "draft" }] },
      },
    });
  }, []);

  const hasOpenComment = draft !== null;
  useEffect(() => {
    if (!onCommentDraftOpenChange) return;
    onCommentDraftOpenChange(hasOpenComment);
    return () => onCommentDraftOpenChange(false);
  }, [hasOpenComment, onCommentDraftOpenChange]);
  return (
    <StyledDiffCodeView<DiffCommentAnnotationGroup>
      key={codeViewKey}
      {...(viewerRef ? { viewerRef } : {})}
      {...(className ? { className } : {})}
      {...(unsafeCSSExtra ? { unsafeCSSExtra } : {})}
      headerHeight={headerHeight}
      {...(renderCodeViewFooter ? { renderCodeViewFooter } : {})}
      {...(onScroll ? { onScroll } : {})}
      items={items}
      selectedLines={selectedLines}
      onSelectedLinesChange={setSelectedLines}
      options={{
        ...options,
        enableGutterUtility: !hasOpenComment,
        enableLineSelection: !hasOpenComment,
        onGutterUtilityClick: beginComment,
      }}
      renderCustomHeader={(item) =>
        item.type === "diff"
          ? renderCustomHeader(item.fileDiff, item.id, item.collapsed === true)
          : null
      }
      renderAnnotation={(annotation, item) => {
        const hasDraft = annotation.metadata.entries.some((entry) => entry.kind === "draft");
        return (
          <div className={hasDraft ? "py-1" : "flex flex-col"}>
            {annotation.metadata.entries.map((entry) => (
              <DiffCommentAnnotation
                key={entry.id}
                kind={entry.kind}
                rangeLabel={entry.rangeLabel}
                text={entry.kind === "draft" ? draftText : entry.text}
                onTextChange={setDraftText}
                // Cancelling an edit drops only the draft; the saved comment stays.
                onCancel={() => removeEntry(entry.id)}
                onComment={(text) => submitEntry(entry.id, text)}
                onDelete={() => removeEntry(entry.id)}
                {...(entry.kind === "comment" && !hasOpenComment
                  ? { onEdit: () => editEntry(item.id, entry) }
                  : {})}
              />
            ))}
            {annotation.metadata.marker ? (
              <div className="flex items-center gap-2.5 px-3 py-2 font-sans">
                <span aria-hidden className="h-px flex-1 bg-border" />
                <span className="text-muted-foreground text-xs tabular-nums">
                  {annotation.metadata.marker}
                </span>
                <span aria-hidden className="h-px flex-1 bg-border" />
              </div>
            ) : null}
          </div>
        );
      }}
    />
  );
}
