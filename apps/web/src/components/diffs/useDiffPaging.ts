import type { CodeViewScrollTarget, FileDiffMetadata } from "@pierre/diffs";
import type { ResolvedKeybindingsConfig } from "@e6tools/contracts";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import { resolveShortcutCommand } from "~/keybindings";
import { isEditableFocused } from "~/lib/editableFocus";

import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  changeStart,
  landAfterMark,
  nextDiffStep,
  type DiffPagingFile,
  type DiffPagingStep,
} from "./diffPaging.logic";

/** One file in the diff body, in body order. */
export interface DiffPagingItem {
  /** The viewer's item id. */
  readonly id: string;
  readonly path: string;
  readonly fileDiff: FileDiffMetadata;
  readonly collapsed: boolean;
  /** Its patch has not loaded, so it has no changes to page through yet. */
  readonly pending?: boolean;
}

interface ScrollViewLike {
  getRenderedItems(): ReadonlyArray<{ readonly id: string; readonly element: HTMLElement }>;
  getTopForItem(id: string): number | undefined;
}

interface ViewerLike {
  getInstance(): object | undefined;
  scrollTo(target: CodeViewScrollTarget): void;
}

interface PagingProgress {
  readonly scopeKey: string;
  /** The file the reader is in: the last one paged to, clicked, or scrolled to. */
  readonly current: string | null;
  /** How many of each file's changes have been in view. */
  readonly seen: ReadonlyMap<string, number>;
}

const NO_SEEN: ReadonlyMap<string, number> = new Map();

/**
 * The Diff's paging key and position. V (`diff.nextChange`) pages to the next change not yet
 * seen and, once a file's last change has been in view, marks it reviewed and moves on; J and K
 * (`diff.nextFile`, `diff.previousFile`) move between files. They answer only while the reader
 * works in `panelRef` (the `diffFocus` context) and no text field has the keyboard; key repeat
 * is ignored, so holding V never skips files. The current file follows scrolling as well.
 */
export function useDiffPaging(options: {
  readonly enabled: boolean;
  readonly viewer: ViewerLike | null;
  readonly scopeKey: string;
  readonly items: ReadonlyArray<DiffPagingItem>;
  readonly isReviewed: (path: string) => boolean;
  /** Marks or unmarks a file; the host folds a file it marks. */
  readonly setReviewed: (path: string, reviewed: boolean) => void;
  /** Unfolds a file by its item id. */
  readonly expand: (id: string) => void;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly panelRef: RefObject<HTMLElement | null>;
  /** The element the diff scrolls in, for the height of what is in view. */
  readonly bodyRef: RefObject<HTMLElement | null>;
  /** A change was paged to, for the resume marker. */
  readonly onLanded?: (path: string, changeIndex: number) => void;
}) {
  const { enabled, viewer, scopeKey, items, isReviewed, setReviewed, expand, onLanded } = options;
  const [progress, setProgress] = useState<PagingProgress>({
    scopeKey,
    current: null,
    seen: NO_SEEN,
  });
  const current = progress.scopeKey === scopeKey ? progress.current : null;
  const seen = progress.scopeKey === scopeKey ? progress.seen : NO_SEEN;
  const updateProgress = useCallback(
    (
      update: (previous: { current: string | null; seen: ReadonlyMap<string, number> }) => {
        current: string | null;
        seen: ReadonlyMap<string, number>;
      },
    ) =>
      setProgress((previous) => {
        const base =
          previous.scopeKey === scopeKey ? previous : { scopeKey, current: null, seen: NO_SEEN };
        const next = update(base);
        return next.current === base.current && next.seen === base.seen
          ? previous
          : { scopeKey, ...next };
      }),
    [scopeKey],
  );

  const files = useMemo<DiffPagingFile[]>(
    () =>
      items.map((item) => ({
        path: item.path,
        changeCount: item.pending ? 0 : item.fileDiff.hunks.length,
        reviewed: isReviewed(item.path),
      })),
    [isReviewed, items],
  );
  const indexOfPath = useMemo(
    () => new Map(items.map((item, index) => [item.path, index])),
    [items],
  );
  const currentIndex = current === null ? 0 : (indexOfPath.get(current) ?? 0);
  const seenOf = useCallback((path: string) => seen.get(path) ?? 0, [seen]);
  const step: DiffPagingStep = enabled
    ? nextDiffStep(files, currentIndex, seenOf)
    : { kind: "done" };

  // A scroll waits for the file to be unfolded and in the viewer, then happens once.
  const [target, setTarget] = useState<{
    readonly id: string;
    readonly changeIndex: number | null;
    readonly scopeKey: string;
  } | null>(null);
  const handledTarget = useRef<typeof target>(null);
  useEffect(() => {
    if (target === null || handledTarget.current === target) return;
    if (target.scopeKey !== scopeKey) {
      handledTarget.current = target;
      return;
    }
    const item = items.find((candidate) => candidate.id === target.id);
    if (!viewer?.getInstance() || !item || item.collapsed) return;
    handledTarget.current = target;
    const start =
      target.changeIndex === null ? null : changeStart(item.fileDiff, target.changeIndex);
    viewer.scrollTo(
      start
        ? {
            type: "line",
            id: item.id,
            lineNumber: start.lineNumber,
            side: start.side,
            align: "start",
          }
        : { type: "item", id: item.id, align: "start" },
    );
  }, [items, scopeKey, target, viewer]);

  const land = useCallback(
    (landing: DiffPagingStep) => {
      if (landing.kind !== "change") return;
      const item = items[landing.fileIndex];
      if (!item) return;
      if (item.collapsed) expand(item.id);
      const changeIndex = landing.changeIndex;
      updateProgress((previous) => {
        if (changeIndex === null) return { current: item.path, seen: previous.seen };
        const seenHere = previous.seen.get(item.path) ?? 0;
        if (seenHere > changeIndex) return { current: item.path, seen: previous.seen };
        const nextSeen = new Map(previous.seen);
        nextSeen.set(item.path, changeIndex + 1);
        return { current: item.path, seen: nextSeen };
      });
      setTarget({ id: item.id, changeIndex, scopeKey });
      if (changeIndex !== null) onLanded?.(item.path, changeIndex);
    },
    [expand, items, onLanded, scopeKey, updateProgress],
  );

  const advance = useCallback(() => {
    if (step.kind === "change") {
      land(step);
      return;
    }
    if (step.kind !== "mark") return;
    const item = items[step.fileIndex];
    if (!item) return;
    setReviewed(item.path, true);
    // Advisory and quiet: a plain note with the way back, nothing celebrated.
    const toastId = toastManager.add(
      stackedThreadToast({
        type: "info",
        title: "Marked reviewed",
        timeout: 5_000,
        actionProps: {
          children: "Undo",
          onClick: () => {
            toastManager.close(toastId);
            setReviewed(item.path, false);
            expand(item.id);
          },
        },
      }),
    );
    if (step.next !== null) land(landAfterMark(files, step.next, seenOf));
  }, [expand, files, items, land, seenOf, setReviewed, step]);

  const goToFile = useCallback(
    (delta: 1 | -1) => {
      const index = currentIndex + delta;
      const item = items[index];
      if (!item) return;
      if (item.collapsed && !isReviewed(item.path)) expand(item.id);
      updateProgress((previous) => ({ current: item.path, seen: previous.seen }));
      setTarget({ id: item.id, changeIndex: null, scopeKey });
    },
    [currentIndex, expand, isReviewed, items, scopeKey, updateProgress],
  );

  /** A rail click: the host scrolls; this only moves the position. */
  const select = useCallback(
    (path: string) => updateProgress((previous) => ({ current: path, seen: previous.seen })),
    [updateProgress],
  );

  // Scrolling moves the current file and counts a file's changes seen once its end is in view.
  // Measured once per frame, from the few files the viewer has rendered.
  const frame = useRef<number | null>(null);
  const onScroll = useCallback(
    (scrollTop: number, view: ScrollViewLike) => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const viewport = options.bodyRef.current?.clientHeight ?? 0;
        const byId = new Map(items.map((item) => [item.id, item]));
        const placed = view
          .getRenderedItems()
          .flatMap((rendered) => {
            const item = byId.get(rendered.id);
            const top = view.getTopForItem(rendered.id);
            if (!item || top === undefined) return [];
            return [{ item, top, bottom: top + rendered.element.offsetHeight }];
          })
          .toSorted((left, right) => left.top - right.top);
        const inView = placed.find((entry) => entry.bottom > scrollTop + 4);
        const ended = placed.filter(
          (entry) =>
            !entry.item.collapsed &&
            !entry.item.pending &&
            entry.bottom > scrollTop &&
            entry.bottom <= scrollTop + viewport + 2,
        );
        updateProgress((previous) => {
          const unseen = ended.filter(
            ({ item }) => (previous.seen.get(item.path) ?? 0) < item.fileDiff.hunks.length,
          );
          const nextSeen =
            unseen.length === 0
              ? previous.seen
              : new Map([
                  ...previous.seen,
                  ...unseen.map(({ item }) => [item.path, item.fileDiff.hunks.length] as const),
                ]);
          return { current: inView?.item.path ?? previous.current, seen: nextSeen };
        });
      });
    },
    [items, options.bodyRef, updateProgress],
  );
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  // The keys answer only while the reader is working in the panel: focus inside it, or the last
  // click landed there.
  const pointerInPanel = useRef(false);
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!enabled || event.defaultPrevented) return;
    const panel = options.panelRef.current;
    if (!panel) return;
    const diffFocus = panel.contains(document.activeElement) || pointerInPanel.current;
    if (!diffFocus) return;
    const command = resolveShortcutCommand(event, options.keybindings, {
      context: { diffFocus: true, editableFocus: isEditableFocused(event.target) },
    });
    if (
      command !== "diff.nextChange" &&
      command !== "diff.nextFile" &&
      command !== "diff.previousFile"
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (command === "diff.nextChange") advance();
    else goToFile(command === "diff.nextFile" ? 1 : -1);
  });
  const onPointerDown = useEffectEvent((event: PointerEvent) => {
    pointerInPanel.current =
      event.target instanceof Node && options.panelRef.current?.contains(event.target) === true;
  });
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => onKeyDown(event);
    const pointerDown = (event: PointerEvent) => onPointerDown(event);
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("pointerdown", pointerDown, true);
    return () => {
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("pointerdown", pointerDown, true);
    };
  }, []);

  return {
    /** The file the reader is in, or null before they have moved. */
    currentPath: current,
    currentIndex,
    seenOf,
    step,
    advance,
    goToFile,
    select,
    onScroll,
  };
}
