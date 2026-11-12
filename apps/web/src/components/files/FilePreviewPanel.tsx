import { Spinner } from "~/components/ui/spinner";
import type {
  ChatFileAttachment,
  EditorId,
  EnvironmentId,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
} from "@e6tools/contracts";
import { filePreviewDelimiter } from "@e6tools/shared/delimitedPreview";
import {
  isWorkspaceAudioPreviewPath,
  isWorkspaceImagePreviewPath,
  isWorkspaceVideoPreviewPath,
} from "@e6tools/shared/filePreview";
import { VirtualizedFile, type SelectedLineRange } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/editor";
import { EditProvider, File, type FileOptions, Virtualizer } from "@pierre/diffs/react";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@e6tools/client-runtime/state/runtime";
import { mediaFileReference } from "@e6tools/client-runtime/media-reference";
import { FolderTree } from "lucide-react";
import * as Schema from "effect/Schema";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { isBrowserPreviewFile, openFileInPreview } from "~/browser/openFileInPreview";
import { useAssetUrlRefresh, useAssetUrlState } from "~/assets/assetUrls";
import { MediaVideoPlayer } from "~/components/media/MediaVideoPlayer";
import { MediaActions, type MediaActionSource } from "~/components/media/MediaActions";
import { useRemoteOpenState } from "~/remoteOpen";
import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useWorkspaceMutationRefresh } from "~/hooks/useWorkspaceMutationRefresh";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";
import { isPreviewSupportedInRuntime } from "~/previewStateStore";
import { isAbsolutePath, resolvePathLinkTarget } from "~/terminal-links";
import { ScrollArea } from "~/components/ui/scroll-area";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { buildFileReviewComment } from "~/reviewCommentContext";
import { assetEnvironment } from "~/state/assets";
import { useEnvironmentHttpBaseUrl, usePrimaryEnvironmentId } from "~/state/environments";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";

import { AttachmentFilePreview } from "./AttachmentFilePreview";
import { AudioPreview } from "./AudioPreview";
import { BrowserDocumentFrame, isPdfPreviewFile } from "./BrowserDocumentFrame";
import { DelimitedTablePreview } from "./DelimitedTablePreview";
import FileBrowserPanel from "./FileBrowserPanel";
import { FileBreadcrumbs } from "./FileBreadcrumbs";
import { FileMarkdownPreview } from "./FileMarkdownPreview";
import {
  type FileCommentAnnotationEntry,
  type FileCommentAnnotationGroup,
  type FileCommentLineAnnotation,
  formatFileCommentLines,
  fileLinesText,
  formatFileCommentRange,
  nextFileCommentId,
  normalizeFileCommentRange,
  remapFileCommentAnnotations,
  withFileSelectionBar,
  withoutFileSelectionBar,
} from "./fileCommentAnnotations";
import { installFileEditorDismissal } from "./fileEditorDismissal";
import {
  FILE_LINK_REVEAL_ATTRIBUTE,
  FILE_LINK_REVEAL_UNSAFE_CSS,
  FileSurfaceAction,
  FileSurfaceFailure,
  FileSurfaceLoading,
} from "./fileSurfaceChrome";
import { PanelSurfaceHeader } from "../panel/PanelSurfaceHeader";
import SourceFilePreview from "./ReadOnlySourcePreview";
import { resolveCenteredFileLineScrollTop } from "./fileLineReveal";
import { DiffCommentAnnotation } from "../diffs/DiffCommentAnnotation";
import { projectFileCacheKey, projectFileEditorCacheKey } from "./fileContentRevision";
import {
  FILE_EXPLORER_COLUMN_MIN_PANEL_WIDTH,
  fileExplorerToggleShown,
  isMarkdownPreviewFile,
  resolveFileExplorerLayout,
  setMarkdownTaskChecked,
} from "./filePreviewMode";
import { fileCommentCount } from "~/lib/attachedForAgent";

import { AttachedCountButton } from "../attached/AttachedCountButton";
import { FileMoreMenu } from "./FileMoreMenu";
import { heldFilePaths, useFileEditStore } from "./fileEditStore";
import { useFileEditSession } from "./useFileEditSession";
import { useThreadFilesContext } from "./useThreadFilesContext";
import { recentFilesOutsideChanged, resolveFilesFilter } from "./threadChangedFiles";
import { scopedThreadKey } from "@e6tools/client-runtime/environment";
import { OpenInPicker } from "~/components/chat/OpenInPicker";
import { openCommandPalette } from "~/commandPaletteBus";
import { useDiffPanelStore } from "~/diffPanelStore";
import { shortcutLabelForCommand } from "~/keybindings";
import { useRightPanelStore } from "~/rightPanelStore";
import { RECENT_FILES_LIMIT, useUiStateStore } from "~/uiStateStore";
import { DiffStat } from "../DiffStat";
import { Button } from "../ui/button";
import { MenuItem } from "../ui/menu";
import { getOptimisticProjectFileQueryData, useProjectFileQuery } from "./projectFilesQueryState";

interface FilePreviewPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  relativePath: string | null;
  attachment?: ChatFileAttachment;
  threadRef: ScopedThreadRef;
  composerDraftTarget: ScopedThreadRef | DraftId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  revealLine: number | null;
  revealRequestId: number;
  /**
   * "files": the Files tab, with the explorer beside the file. "kept": a file kept as its own
   * tab, which starts without an explorer.
   */
  variant: "files" | "kept";
  onOpenFile: (relativePath: string) => void;
  /** "Keep as its own tab", offered by the Files tab. */
  /** `line` is where the reader is in the file, so the kept tab opens there. */
  onKeepAsTab: (relativePath: string, line: number | undefined) => void;
  onPendingChange: (relativePath: string, pending: boolean) => void;
  selectedFilePending: boolean;
  workspaceMutationId: string | null;
}

const RENDER_MARKDOWN_STORAGE_KEY = "e6code.renderMarkdown";
const RENDER_BROWSER_FILE_STORAGE_KEY = "e6code.renderBrowserFile";
const RENDER_TABLE_STORAGE_KEY = "e6code.renderTable";
type FilePostRender = NonNullable<FileOptions<unknown>["onPostRender"]>;

function WorkspaceImagePreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly absolutePath: string;
  readonly workspaceRoot: string;
  readonly alt: string;
  readonly workspaceMutationId: string | null;
}) {
  const resource = useMemo(
    () => ({
      _tag: "workspace-file" as const,
      threadId: props.threadRef.threadId,
      path: props.absolutePath,
    }),
    [props.threadRef.threadId, props.absolutePath],
  );
  const assetUrl = useAssetUrlState(props.environmentId, resource);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const revisionSuffix =
    props.workspaceMutationId === null
      ? ""
      : `${assetUrl._tag === "Success" && assetUrl.url.includes("?") ? "&" : "?"}workspace-revision=${encodeURIComponent(props.workspaceMutationId)}`;
  const imageUrl = assetUrl._tag === "Success" ? `${assetUrl.url}${revisionSuffix}` : null;
  const actionsSource: MediaActionSource = {
    kind: "image",
    name: props.alt,
    src: imageUrl,
    reference: mediaFileReference(props.absolutePath, props.workspaceRoot),
    asset: { environmentId: props.environmentId, resource },
  };

  if (assetUrl._tag === "Failure" || (imageUrl !== null && failedUrl === imageUrl)) {
    return (
      <MediaActions source={actionsSource}>
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs leading-relaxed text-destructive">
          Unable to load workspace image.
        </div>
      </MediaActions>
    );
  }

  return assetUrl._tag === "Success" && imageUrl !== null ? (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
      <MediaActions source={actionsSource}>
        <img
          className="max-h-full max-w-full object-contain"
          src={imageUrl}
          alt={props.alt}
          onError={() => setFailedUrl(imageUrl)}
        />
      </MediaActions>
    </div>
  ) : (
    <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
      <Spinner className="size-5" />
    </div>
  );
}

/**
 * Renders an HTML or PDF file in place from its signed asset URL. HTML runs in
 * a sandboxed frame with an opaque origin, so a page cannot reach the app's
 * session or storage. A file inside the workspace may load sibling assets; a
 * host file outside it is served on its own.
 */
function WorkspaceBrowserPreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly absolutePath: string;
  readonly workspaceRoot: string;
  readonly title: string;
  readonly workspaceMutationId: string | null;
}) {
  const insideWorkspace =
    mediaFileReference(props.absolutePath, props.workspaceRoot).relativePath !== undefined;
  const resource = useMemo(
    () => ({
      _tag: insideWorkspace ? ("workspace-file" as const) : ("media-file" as const),
      threadId: props.threadRef.threadId,
      path: props.absolutePath,
    }),
    [insideWorkspace, props.threadRef.threadId, props.absolutePath],
  );
  const assetUrl = useAssetUrlState(props.environmentId, resource);
  const revisionSuffix =
    props.workspaceMutationId === null
      ? ""
      : `${assetUrl._tag === "Success" && assetUrl.url.includes("?") ? "&" : "?"}workspace-revision=${encodeURIComponent(props.workspaceMutationId)}`;

  if (assetUrl._tag === "Failure") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs leading-relaxed text-destructive">
        Unable to load file preview.
      </div>
    );
  }
  if (assetUrl._tag !== "Success") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
        <Spinner className="size-5" />
      </div>
    );
  }
  return (
    <BrowserDocumentFrame
      src={`${assetUrl.url}${revisionSuffix}`}
      title={props.title}
      pdf={isPdfPreviewFile(props.absolutePath)}
    />
  );
}

function WorkspaceVideoPreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly absolutePath: string;
  readonly workspaceRoot: string;
  readonly name: string;
  readonly workspaceMutationId: string | null;
}) {
  const resource = useMemo(
    () => ({
      _tag: "media-file" as const,
      threadId: props.threadRef.threadId,
      path: props.absolutePath,
    }),
    [props.threadRef.threadId, props.absolutePath],
  );
  const assetUrl = useAssetUrlState(props.environmentId, resource);
  const refreshAssetUrl = useAssetUrlRefresh(props.environmentId, resource);
  useWorkspaceMutationRefresh({
    mutationId: props.workspaceMutationId,
    resourceKey: JSON.stringify([props.environmentId, resource]),
    refresh: () => {
      // Failed refreshes flow through assetUrl and can be retried from the player.
      void refreshAssetUrl().catch(() => undefined);
    },
  });
  const revisionSuffix =
    props.workspaceMutationId === null
      ? ""
      : `${assetUrl._tag === "Success" && assetUrl.url.includes("?") ? "&" : "?"}workspace-revision=${encodeURIComponent(props.workspaceMutationId)}`;
  const latestUrl = assetUrl._tag === "Success" ? `${assetUrl.url}${revisionSuffix}` : null;

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
      <MediaVideoPlayer
        src={latestUrl}
        sourceFailed={assetUrl._tag === "Failure"}
        label={props.name}
        revision={props.workspaceMutationId}
        preload="metadata"
        className="flex h-full min-h-0 w-full max-w-5xl items-center justify-center"
        onRetry={refreshAssetUrl}
        actionsSource={{
          kind: "video",
          name: props.name,
          src: latestUrl,
          reference: mediaFileReference(props.absolutePath, props.workspaceRoot),
          asset: { environmentId: props.environmentId, resource },
        }}
      />
    </div>
  );
}

function WorkspaceAudioPreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly absolutePath: string;
  readonly name: string;
  readonly workspaceMutationId: string | null;
}) {
  const resource = useMemo(
    () => ({
      _tag: "media-file" as const,
      threadId: props.threadRef.threadId,
      path: props.absolutePath,
    }),
    [props.threadRef.threadId, props.absolutePath],
  );
  const assetUrl = useAssetUrlState(props.environmentId, resource);
  const refreshAssetUrl = useAssetUrlRefresh(props.environmentId, resource);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  useWorkspaceMutationRefresh({
    mutationId: props.workspaceMutationId,
    resourceKey: JSON.stringify([props.environmentId, resource]),
    refresh: () => {
      void refreshAssetUrl().catch(() => undefined);
    },
  });
  const revisionSuffix =
    props.workspaceMutationId === null
      ? ""
      : `${assetUrl._tag === "Success" && assetUrl.url.includes("?") ? "&" : "?"}workspace-revision=${encodeURIComponent(props.workspaceMutationId)}`;
  const url = assetUrl._tag === "Success" ? `${assetUrl.url}${revisionSuffix}` : null;
  if (assetUrl._tag === "Failure" || (url !== null && failedUrl === url)) {
    return (
      <FileSurfaceFailure
        message="Unable to load audio."
        onRetry={() => {
          setFailedUrl(null);
          void refreshAssetUrl().catch(() => undefined);
        }}
      />
    );
  }
  if (url === null) return <FileSurfaceLoading />;
  return <AudioPreview src={url} name={props.name} onError={() => setFailedUrl(url)} />;
}

function clampFileLine(contents: string, requestedLine: number): number {
  let lineCount = 1;
  for (let index = 0; index < contents.length; index += 1) {
    const character = contents.charCodeAt(index);
    if (character === 10) {
      lineCount += 1;
    } else if (character === 13) {
      lineCount += 1;
      if (contents.charCodeAt(index + 1) === 10) index += 1;
    }
  }
  return Math.min(Math.max(1, requestedLine), lineCount);
}

function updateFileLinkReveal(fileContainer: HTMLElement, line: number | null): void {
  const root = fileContainer.shadowRoot ?? fileContainer;
  for (const element of root.querySelectorAll<HTMLElement>(`[${FILE_LINK_REVEAL_ATTRIBUTE}]`)) {
    element.removeAttribute(FILE_LINK_REVEAL_ATTRIBUTE);
  }
  if (line === null) return;

  root
    .querySelector<HTMLElement>(`[data-line="${line}"]`)
    ?.setAttribute(FILE_LINK_REVEAL_ATTRIBUTE, "");
  root
    .querySelector<HTMLElement>(`[data-column-number="${line}"]`)
    ?.setAttribute(FILE_LINK_REVEAL_ATTRIBUTE, "");
}

/**
 * Frames to keep retrying while the file contents or line metrics are not
 * available yet (fresh mounts hydrate asynchronously).
 */
const REVEAL_MAX_ATTEMPTS = 30;
/**
 * After scrolling to the target, hold it for a short window so late
 * programmatic scroll resets (editable-editor focus and state restoration)
 * cannot silently snap the file back to the top. Real user input cancels the
 * guard immediately.
 */
const REVEAL_GUARD_FRAMES = 20;
const REVEAL_GUARD_TOLERANCE_PX = 2;

interface FileRevealState {
  frameId: number | null;
  cancelGuard: (() => void) | null;
  handledRequestId: number | null;
  latestRequestId: number | null;
}

function useFileLineReveal(
  relativePath: string | null,
  revealLine: number | null,
  revealRequestId: number,
): FilePostRender {
  const [revealStatesByPath] = useState(() => new Map<string, FileRevealState>());

  return useCallback<FilePostRender>(
    (fileContainer, instance, phase) => {
      if (relativePath === null) return;

      const existingState = revealStatesByPath.get(relativePath);
      const state: FileRevealState = existingState ?? {
        frameId: null,
        cancelGuard: null,
        handledRequestId: null,
        latestRequestId: null,
      };
      if (!existingState) revealStatesByPath.set(relativePath, state);

      const cancelPendingReveal = () => {
        if (state.frameId !== null) {
          cancelAnimationFrame(state.frameId);
          state.frameId = null;
        }
        state.cancelGuard?.();
      };

      if (phase === "unmount") {
        cancelPendingReveal();
        return;
      }

      const contents = instance.file?.contents;
      const targetLine =
        revealLine === null || contents === undefined ? null : clampFileLine(contents, revealLine);
      updateFileLinkReveal(fileContainer, targetLine);

      if (!(instance instanceof VirtualizedFile)) return;

      if (state.latestRequestId !== revealRequestId) {
        cancelPendingReveal();
        state.latestRequestId = revealRequestId;
        state.handledRequestId = null;
      }

      if (revealLine === null) {
        fileContainer.style.minHeight = "";
        return;
      }

      const scrollContainer = fileContainer.closest<HTMLElement>(".file-preview-virtualizer");
      if (!scrollContainer) return;
      fileContainer.style.minHeight = `${Math.ceil(
        Math.max(instance.height, scrollContainer.clientHeight),
      )}px`;

      if (state.handledRequestId === revealRequestId || state.frameId !== null) {
        return;
      }

      const resolveScrollTarget = (line: number): number | null => {
        const linePosition = instance.getLinePosition(line);
        if (!linePosition) return null;

        const scrollContainerRect = scrollContainer.getBoundingClientRect();
        const fileTop =
          scrollContainer.scrollTop +
          fileContainer.getBoundingClientRect().top -
          scrollContainerRect.top;
        const root = fileContainer.shadowRoot ?? fileContainer;
        const renderedLineElement = root.querySelector<HTMLElement>(`[data-line="${line}"]`);
        const renderedLineRect = renderedLineElement?.getBoundingClientRect();

        return resolveCenteredFileLineScrollTop({
          scrollTop: scrollContainer.scrollTop,
          scrollHeight: scrollContainer.scrollHeight,
          viewportTop: scrollContainerRect.top,
          viewportHeight: scrollContainer.clientHeight,
          fileTop,
          estimatedLine: linePosition,
          ...(renderedLineRect && renderedLineRect.height > 0
            ? {
                renderedLine: {
                  top: renderedLineRect.top,
                  height: renderedLineRect.height,
                },
              }
            : {}),
        });
      };

      const guardScrollTarget = (line: number) => {
        let framesLeft = REVEAL_GUARD_FRAMES;
        let guardFrameId: number | null = null;
        const cancelGuard = () => {
          if (guardFrameId !== null) {
            cancelAnimationFrame(guardFrameId);
            guardFrameId = null;
          }
          scrollContainer.removeEventListener("wheel", cancelGuard);
          scrollContainer.removeEventListener("touchstart", cancelGuard);
          scrollContainer.removeEventListener("pointerdown", cancelGuard, true);
          window.removeEventListener("keydown", cancelGuard, true);
          if (state.cancelGuard === cancelGuard) state.cancelGuard = null;
        };
        scrollContainer.addEventListener("wheel", cancelGuard, { passive: true });
        scrollContainer.addEventListener("touchstart", cancelGuard, { passive: true });
        // Pierre stops gutter pointer events from bubbling. Listen in capture
        // so starting a comment cancels the reveal guard before the row expands.
        scrollContainer.addEventListener("pointerdown", cancelGuard, {
          passive: true,
          capture: true,
        });
        window.addEventListener("keydown", cancelGuard, true);
        const holdTarget = () => {
          guardFrameId = null;
          framesLeft -= 1;
          if (framesLeft <= 0 || !scrollContainer.isConnected) {
            cancelGuard();
            return;
          }
          const targetTop = resolveScrollTarget(line);
          if (
            targetTop !== null &&
            Math.abs(scrollContainer.scrollTop - targetTop) > REVEAL_GUARD_TOLERANCE_PX
          ) {
            scrollContainer.scrollTop = targetTop;
          }
          guardFrameId = requestAnimationFrame(holdTarget);
        };
        guardFrameId = requestAnimationFrame(holdTarget);
        state.cancelGuard = cancelGuard;
      };

      const scheduleReveal = (attempt: number) => {
        state.frameId = requestAnimationFrame(() => {
          state.frameId = null;
          if (state.latestRequestId !== revealRequestId || !fileContainer.isConnected) {
            return;
          }

          // Contents and line metrics can lag the first post-render on fresh
          // mounts; clamping against missing contents would scroll to line 1
          // and wrongly mark the request handled.
          const currentContents = instance.file?.contents;
          const line =
            currentContents === undefined ? null : clampFileLine(currentContents, revealLine);
          const targetTop = line === null ? null : resolveScrollTarget(line);
          if (line === null || targetTop === null) {
            if (attempt < REVEAL_MAX_ATTEMPTS) scheduleReveal(attempt + 1);
            return;
          }
          updateFileLinkReveal(fileContainer, line);

          scrollContainer.scrollTop = targetTop;
          state.handledRequestId = revealRequestId;
          guardScrollTarget(line);
        });
      };

      scheduleReveal(0);
    },
    [revealStatesByPath, relativePath, revealLine, revealRequestId],
  );
}

/** "4.2 MB", for the truncation notice. */
function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
}

/** The file line under the middle of the scrolled view, or null before the file has rendered. */
function readCenterLine(scroller: HTMLElement, fileContainer: HTMLElement | null): number | null {
  if (!fileContainer) return null;
  const root = fileContainer.shadowRoot ?? fileContainer;
  const bounds = scroller.getBoundingClientRect();
  const middle = bounds.top + bounds.height / 2;
  for (const element of root.querySelectorAll<HTMLElement>("[data-line]")) {
    const rect = element.getBoundingClientRect();
    if (rect.top <= middle && middle < rect.bottom) {
      const line = Number(element.dataset.line);
      return Number.isSafeInteger(line) && line > 0 ? line : null;
    }
  }
  return null;
}

interface EditableFileSurfaceProps {
  environmentId: EnvironmentId;
  cwd: string;
  relativePath: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
  contents: string;
  resolvedTheme: "light" | "dark";
  revealRequestId: number;
  wordWrap: boolean;
  onPostRender: FilePostRender;
  /** The reader changed the file; the edit session shows and saves it. */
  onEdit: (contents: string) => void;
  /** The line at the middle of the view, read when the file is left, for Recently opened. */
  onLeave: (line: number | null) => void;
  /** Kept at the line at the middle of the view as the reader scrolls. */
  viewLineRef: RefObject<number | null>;
}

interface FileSelectionOverride {
  revealRequestId: number;
  range: SelectedLineRange | null;
}

function EditableFileSurface({
  environmentId,
  cwd,
  relativePath,
  composerDraftTarget,
  contents,
  resolvedTheme,
  revealRequestId,
  wordWrap,
  onPostRender,
  onEdit,
  onLeave,
  viewLineRef,
}: EditableFileSurfaceProps) {
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const removeReviewComment = useComposerDraftStore((store) => store.removeReviewComment);
  const [lineAnnotations, setLineAnnotations] = useState<FileCommentLineAnnotation[]>([]);
  const [selectionOverride, setSelectionOverride] = useState<FileSelectionOverride | null>(null);
  const selectedRange =
    selectionOverride?.revealRequestId === revealRequestId ? selectionOverride.range : null;
  const setSelectedRange = useCallback(
    (range: SelectedLineRange | null) => {
      setSelectionOverride({ revealRequestId, range });
    },
    [revealRequestId],
  );
  const surfaceRef = useRef<HTMLDivElement>(null);
  const selectionFrameRef = useRef<number | null>(null);
  const fileContainerRef = useRef<HTMLElement | null>(null);
  // The line at the middle of the view, kept as the reader scrolls so leaving the file can
  // record where they were.
  const centerLineRef = useRef<number | null>(null);
  const onLeaveRef = useRef(onLeave);
  useEffect(() => {
    onLeaveRef.current = onLeave;
  });
  useEffect(() => {
    const scroller = surfaceRef.current?.querySelector<HTMLElement>(".file-preview-virtualizer");
    if (!scroller) return;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      centerLineRef.current = readCenterLine(scroller, fileContainerRef.current);
      viewLineRef.current = centerLineRef.current;
    };
    const onScroll = () => {
      if (frame === null) frame = requestAnimationFrame(measure);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [viewLineRef]);
  useEffect(() => () => onLeaveRef.current(centerLineRef.current), []);
  const editor = useMemo(
    () =>
      new Editor<FileCommentAnnotationGroup>({
        persistState: true,
        persistStateStorage: "inMemory",
        onChange: (file, nextLineAnnotations) => {
          onEdit(file.contents);
          if (nextLineAnnotations) {
            const remapped = withoutFileSelectionBar(
              remapFileCommentAnnotations(nextLineAnnotations as FileCommentLineAnnotation[]),
            );
            setLineAnnotations(remapped);
            for (const annotation of remapped) {
              for (const entry of annotation.metadata.entries) {
                if (entry.kind !== "comment") continue;
                addReviewComment(
                  composerDraftTarget,
                  buildFileReviewComment({
                    id: entry.id,
                    filePath: relativePath,
                    startLine: entry.startLine,
                    endLine: entry.endLine,
                    text: entry.text,
                    contents: file.contents,
                  }),
                );
              }
            }
          }
        },
      }),
    [addReviewComment, composerDraftTarget, onEdit, relativePath],
  );

  useEffect(
    () => () => {
      editor.cleanUp();
    },
    [editor],
  );

  const removeAnnotationEntry = useCallback(
    (entryId: string) => {
      setSelectedRange(null);
      removeReviewComment(composerDraftTarget, entryId);
      setLineAnnotations((current) => {
        return current.flatMap((annotation) => {
          const entries = annotation.metadata.entries.filter((entry) => entry.id !== entryId);
          return entries.length > 0 ? [{ ...annotation, metadata: { entries } }] : [];
        });
      });
    },
    [composerDraftTarget, removeReviewComment, setSelectedRange],
  );

  // Edit reopens a saved comment as a draft; saving replaces it in the composer, and Cancel puts
  // the saved words back.
  const updateAnnotationEntry = useCallback(
    (
      entryId: string,
      update: (entry: FileCommentAnnotationEntry) => FileCommentAnnotationEntry,
    ) => {
      setLineAnnotations((current) =>
        current.map((annotation) => ({
          ...annotation,
          metadata: {
            entries: annotation.metadata.entries.map((entry) =>
              entry.id === entryId ? update(entry) : entry,
            ),
          },
        })),
      );
    },
    [],
  );
  const editAnnotationEntry = useCallback(
    (entryId: string) => {
      setSelectedRange(null);
      updateAnnotationEntry(entryId, (entry) => ({
        ...entry,
        kind: "draft",
        savedText: entry.text,
      }));
    },
    [setSelectedRange, updateAnnotationEntry],
  );
  const cancelAnnotationEntry = useCallback(
    (entry: FileCommentAnnotationEntry) => {
      const { savedText } = entry;
      if (savedText === undefined) {
        removeAnnotationEntry(entry.id);
        return;
      }
      setSelectedRange(null);
      updateAnnotationEntry(entry.id, ({ savedText: _saved, ...rest }) => ({
        ...rest,
        kind: "comment",
        text: savedText,
      }));
    },
    [removeAnnotationEntry, setSelectedRange, updateAnnotationEntry],
  );

  const submitAnnotationEntry = useCallback(
    (entryId: string, text: string) => {
      setSelectedRange(null);
      const entry = lineAnnotations
        .flatMap((annotation) => annotation.metadata.entries)
        .find((candidate) => candidate.id === entryId);
      if (entry) {
        addReviewComment(
          composerDraftTarget,
          buildFileReviewComment({
            id: entry.id,
            filePath: relativePath,
            startLine: entry.startLine,
            endLine: entry.endLine,
            text,
            contents,
          }),
        );
      }
      setLineAnnotations((current) =>
        current.map((annotation) => ({
          ...annotation,
          metadata: {
            entries: annotation.metadata.entries.map((annotationEntry) =>
              annotationEntry.id === entryId
                ? (({ savedText: _saved, ...rest }) => ({
                    ...rest,
                    kind: "comment" as const,
                    text,
                  }))(annotationEntry)
                : annotationEntry,
            ),
          },
        })),
      );
    },
    [
      addReviewComment,
      composerDraftTarget,
      contents,
      lineAnnotations,
      relativePath,
      setSelectedRange,
    ],
  );

  const beginComment = useCallback(
    (range: SelectedLineRange) => {
      editor.setSelections([]);
      editor.blur();
      const { startLine, endLine } = normalizeFileCommentRange(range);
      const draftEntry: FileCommentAnnotationEntry = {
        id: nextFileCommentId(),
        kind: "draft",
        startLine,
        endLine,
        text: "",
      };
      setLineAnnotations((current) => {
        const withoutDraft = current.flatMap((annotation) => {
          const entries = annotation.metadata.entries.filter((entry) => entry.kind !== "draft");
          return entries.length > 0 ? [{ ...annotation, metadata: { entries } }] : [];
        });
        const existingIndex = withoutDraft.findIndex(
          (annotation) => annotation.lineNumber === endLine,
        );
        if (existingIndex < 0) {
          return [
            ...withoutDraft,
            {
              lineNumber: endLine,
              metadata: { entries: [draftEntry] },
            },
          ];
        }
        return withoutDraft.map((annotation, index) =>
          index === existingIndex
            ? {
                ...annotation,
                metadata: { entries: [...annotation.metadata.entries, draftEntry] },
              }
            : annotation,
        );
      });
    },
    [editor],
  );
  const hasOpenCommentForm = lineAnnotations.some((annotation) =>
    annotation.metadata.entries.some((entry) => entry.kind === "draft"),
  );
  // Board 15: a finished selection first offers Copy and "Comment for the agent" in a bar under
  // its last line, so a selection made to copy does not open a comment form.
  const [selectionBar, setSelectionBar] = useState<{
    readonly startLine: number;
    readonly endLine: number;
  } | null>(null);
  useEffect(() => {
    const root = surfaceRef.current;
    if (!root) return;
    return installFileEditorDismissal({
      root,
      editor,
      isBlocked: () => hasOpenCommentForm,
      onDismiss: () => {
        setSelectedRange(null);
        setSelectionBar(null);
      },
    });
  }, [editor, hasOpenCommentForm, setSelectedRange]);
  const handleLineSelectionChange = useCallback(
    (range: SelectedLineRange | null) => {
      setSelectedRange(range);
      setSelectionBar((current) => {
        if (current === null || range === null) return null;
        const next = normalizeFileCommentRange(range);
        return next.startLine === current.startLine && next.endLine === current.endLine
          ? current
          : null;
      });
    },
    [setSelectedRange],
  );
  const handleLineSelectionEnd = useCallback(
    (range: SelectedLineRange | null) => {
      setSelectedRange(range);
      setSelectionBar(range ? normalizeFileCommentRange(range) : null);
    },
    [setSelectedRange],
  );
  const shownAnnotations = useMemo(
    () =>
      selectionBar && !hasOpenCommentForm
        ? withFileSelectionBar(lineAnnotations, selectionBar.startLine, selectionBar.endLine)
        : lineAnnotations,
    [hasOpenCommentForm, lineAnnotations, selectionBar],
  );
  const copySelection = useCallback(
    (startLine: number, endLine: number) => {
      void writeTextToClipboard(fileLinesText(contents, startLine, endLine), "selection").then(
        () =>
          toastManager.add({
            type: "success",
            title: `Copied ${formatFileCommentLines(startLine, endLine)}`,
          }),
        (error: unknown) =>
          toastManager.add({
            type: "error",
            title: "Failed to copy",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
      );
    },
    [contents],
  );

  const handlePostRender = useCallback<FilePostRender>(
    (fileContainer, instance, phase) => {
      onPostRender(fileContainer, instance, phase);
      fileContainerRef.current = phase === "unmount" ? null : fileContainer;

      if (selectionFrameRef.current !== null) {
        cancelAnimationFrame(selectionFrameRef.current);
        selectionFrameRef.current = null;
      }
      if (phase === "unmount") return;

      selectionFrameRef.current = requestAnimationFrame(() => {
        selectionFrameRef.current = null;
        if (!fileContainer.isConnected) return;
        instance.setSelectedLines(selectedRange, { notify: false });
      });
    },
    [onPostRender, selectedRange],
  );

  return (
    <EditProvider editor={editor}>
      <div ref={surfaceRef} className="flex min-h-0 flex-1">
        <Virtualizer
          className="file-preview-virtualizer min-h-0 flex-1 overflow-auto"
          config={{
            overscrollSize: 600,
            intersectionObserverMargin: 1200,
          }}
        >
          <File<FileCommentAnnotationGroup>
            file={{
              name: relativePath,
              contents,
              cacheKey: projectFileEditorCacheKey(
                environmentId,
                cwd,
                relativePath,
                contents,
                editor.getFile(),
              ),
            }}
            options={{
              disableFileHeader: true,
              enableGutterUtility: !hasOpenCommentForm,
              enableLineSelection: !hasOpenCommentForm,
              onGutterUtilityClick: setSelectedRange,
              onLineSelectionChange: handleLineSelectionChange,
              onLineSelectionEnd: handleLineSelectionEnd,
              overflow: wordWrap ? "wrap" : "scroll",
              theme: resolveDiffThemeName(resolvedTheme),
              preferredHighlighter: PREFERRED_HIGHLIGHTER,
              themeType: resolvedTheme,
              unsafeCSS: FILE_LINK_REVEAL_UNSAFE_CSS,
              onPostRender: handlePostRender,
            }}
            selectedLines={selectedRange}
            lineAnnotations={shownAnnotations}
            renderAnnotation={(annotation) => (
              <div className="py-1">
                {annotation.metadata.entries.map((entry) =>
                  entry.kind === "selection" ? (
                    <div
                      key={entry.id}
                      className="flex justify-end px-3 font-sans"
                      contentEditable={false}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      {/* Neither is filled: most selections are for copying. */}
                      <div
                        role="toolbar"
                        aria-label={`Selected ${formatFileCommentLines(entry.startLine, entry.endLine)}`}
                        className="flex gap-0.5 rounded-xl border border-border bg-surface-floating p-1 shadow-lg"
                      >
                        <Button
                          size="compact"
                          variant="ghost"
                          onClick={() => copySelection(entry.startLine, entry.endLine)}
                        >
                          Copy
                        </Button>
                        <Button
                          size="compact"
                          variant="ghost"
                          onClick={() => {
                            setSelectionBar(null);
                            beginComment({ start: entry.startLine, end: entry.endLine });
                          }}
                        >
                          Comment for the agent
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <DiffCommentAnnotation
                      // Remounted on Edit, so the draft starts from the saved words.
                      key={`${entry.id}:${entry.kind}`}
                      kind={entry.kind}
                      surface="file"
                      rangeLabel={formatFileCommentRange(entry.startLine, entry.endLine)}
                      heading={`Your comment · ${formatFileCommentLines(entry.startLine, entry.endLine)}`}
                      text={entry.text}
                      onCancel={() => cancelAnnotationEntry(entry)}
                      onComment={(text) => submitAnnotationEntry(entry.id, text)}
                      onDelete={() => removeAnnotationEntry(entry.id)}
                      {...(entry.kind === "comment" && !hasOpenCommentForm
                        ? { onEdit: () => editAnnotationEntry(entry.id) }
                        : {})}
                    />
                  ),
                )}
              </div>
            )}
            className="min-h-full"
            contentEditable
          />
        </Virtualizer>
      </div>
    </EditProvider>
  );
}

function RenderedMarkdownSurface({
  environmentId,
  cwd,
  relativePath,
  contents,
  threadRef,
  readOnly,
  onEdit,
}: Omit<
  EditableFileSurfaceProps,
  | "resolvedTheme"
  | "composerDraftTarget"
  | "revealLine"
  | "revealRequestId"
  | "wordWrap"
  | "onPostRender"
  | "onLeave"
  | "viewLineRef"
> & {
  threadRef: ScopedThreadRef;
  readOnly: boolean;
}) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <FileMarkdownPreview
        text={contents}
        cwd={cwd}
        relativePath={relativePath}
        threadRef={threadRef}
        onTaskListChange={
          readOnly
            ? undefined
            : ({ markerOffset, checked }) => {
                const currentContents =
                  getOptimisticProjectFileQueryData(environmentId, cwd, relativePath)?.contents ??
                  contents;
                const nextContents = setMarkdownTaskChecked(currentContents, markerOffset, checked);
                if (nextContents === currentContents) return;
                onEdit(nextContents);
              }
        }
      />
    </ScrollArea>
  );
}

/**
 * Whether the element is narrower than the Files tab needs for its explorer column. Measured
 * before the first paint, so a narrow panel never shows the column for a frame.
 */
function useNarrowPanel(ref: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setNarrow(element.getBoundingClientRect().width < FILE_EXPLORER_COLUMN_MIN_PANEL_WIDTH);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setNarrow(entry.contentRect.width < FILE_EXPLORER_COLUMN_MIN_PANEL_WIDTH);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return narrow;
}

export default function FilePreviewPanel({
  environmentId,
  cwd,
  projectName,
  relativePath,
  attachment,
  threadRef,
  composerDraftTarget,
  keybindings,
  availableEditors,
  revealLine,
  revealRequestId,
  variant,
  onOpenFile,
  onKeepAsTab,
  onPendingChange,
  selectedFilePending,
  workspaceMutationId,
}: FilePreviewPanelProps) {
  const { resolvedTheme } = useTheme();
  const wordWrap = useClientSettings((settings) => settings.wordWrap);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const remoteOpenState = useRemoteOpenState(environmentId);
  const environmentHttpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const createAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
  });
  const openPreview = useAtomCommand(previewEnvironment.open, {
    reportFailure: false,
  });
  const isVideo = relativePath !== null && isWorkspaceVideoPreviewPath(relativePath);
  const isAudio = relativePath !== null && !isVideo && isWorkspaceAudioPreviewPath(relativePath);
  const isImage = relativePath !== null && !isVideo && isWorkspaceImagePreviewPath(relativePath);
  const isMedia = isImage || isVideo || isAudio;
  // PDFs have no text to show; HTML has, and can toggle between page and source.
  const isPdf = relativePath !== null && isPdfPreviewFile(relativePath);
  const isHtml = relativePath !== null && !isPdf && isBrowserPreviewFile(relativePath);
  // A file outside the workspace (an absolute path) is shown, never edited.
  const isHostFile =
    attachment !== undefined || (relativePath !== null && isAbsolutePath(relativePath));
  // Media and PDFs render from their absolute path, so their contents are never
  // shown. The read still runs: a folder named `assets.png` is only knowable as a
  // folder from the read failure, and the server stats before reading, so a folder
  // costs an open and a stat and returns no body.
  const file = useProjectFileQuery(environmentId, cwd, relativePath, attachment === undefined);
  // A chat link cannot tell a folder from a file, so a folder arrives here as
  // a file surface and the read fails. Keep the breadcrumbs, drop the preview
  // pane, and let the tree fill the surface with the folder revealed. Mutation
  // refresh stays on so the surface notices if the path becomes a file. A host
  // path cannot be revealed in the workspace tree, so it keeps the read error.
  const isDirectory = file.isNotFile && !isHostFile;
  // Everything preview-related keys off previewPath; a folder has no preview.
  const previewPath = isDirectory ? null : relativePath;
  const surfaceRef = useRef<HTMLDivElement>(null);
  // Where the reader is in the open file; Keep as its own tab opens the tab there.
  const viewLineRef = useRef<number | null>(null);
  useEffect(() => {
    viewLineRef.current = null;
  }, [relativePath]);
  const narrow = useNarrowPanel(surfaceRef);
  // The header button's state; see resolveFileExplorerLayout.
  const [explorerOpen, setExplorerOpen] = useState(false);
  const explorerLayout = resolveFileExplorerLayout({
    variant,
    relativePath: previewPath,
    attachmentOpen: attachment !== undefined,
    narrow,
    explorerOpen,
  });
  const showsExplorerToggle =
    !isHostFile && previewPath !== null && fileExplorerToggleShown({ variant, narrow });
  // A file picked from the narrow overlay closes it, so the file is what you see next.
  const openFromExplorer = useCallback(
    (path: string) => {
      if (explorerLayout === "overlay") setExplorerOpen(false);
      onOpenFile(path);
    },
    [explorerLayout, onOpenFile],
  );
  // Reading markdown rendered is a preference, not a property of one file. Keeping
  // it on the panel meant a thread switch dropped it and forced source back.
  const [renderMarkdownPreferred, setRenderMarkdownPreferred] = useLocalStorage(
    RENDER_MARKDOWN_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const [renderBrowserFilePreferred, setRenderBrowserFilePreferred] = useLocalStorage(
    RENDER_BROWSER_FILE_STORAGE_KEY,
    true,
    Schema.Boolean,
  );
  const [renderTablePreferred, setRenderTablePreferred] = useLocalStorage(
    RENDER_TABLE_STORAGE_KEY,
    true,
    Schema.Boolean,
  );
  // Paired with the path on purpose: each file surface counts its reveals from
  // one, so a bare id would let a dismissed reveal on one file swallow the first
  // reveal on the next.
  const [handledReveal, setHandledReveal] = useState<{ path: string; requestId: number } | null>(
    null,
  );
  const breadcrumbRef = useRef<HTMLDivElement>(null);
  const isMarkdown = previewPath ? isMarkdownPreviewFile(previewPath) : false;
  const tableDelimiter =
    previewPath && attachment === undefined ? filePreviewDelimiter({ name: previewPath }) : null;
  // A reveal still wins over the preference: the line only exists in the source.
  const revealHandled =
    revealLine === null ||
    (handledReveal?.path === relativePath && handledReveal.requestId === revealRequestId);
  const renderMarkdown = isMarkdown && renderMarkdownPreferred && revealHandled;
  const renderBrowserFile = isPdf || (isHtml && renderBrowserFilePreferred && revealHandled);
  const renderTable = tableDelimiter !== null && renderTablePreferred && revealHandled;
  const renderedMode = isMarkdown
    ? ("markdown" as const)
    : tableDelimiter
      ? ("table" as const)
      : isHtml
        ? ("html" as const)
        : null;
  const canToggleRendered =
    previewPath !== null && attachment === undefined && renderedMode !== null;
  const updateClientSettings = useUpdateClientSettings();
  // Word wrap only reaches the text bodies. A rendered Markdown document, a table and the
  // browser frame all lay themselves out, so the toggle stays hidden rather than inert.
  const showsRawText =
    previewPath !== null &&
    file.data !== null &&
    !(isMarkdown && renderMarkdown) &&
    !(tableDelimiter && renderTable) &&
    !renderBrowserFile;
  const rendered = isMarkdown ? renderMarkdown : tableDelimiter ? renderTable : renderBrowserFile;
  const setRenderedPreferred = isMarkdown
    ? setRenderMarkdownPreferred
    : tableDelimiter
      ? setRenderTablePreferred
      : setRenderBrowserFilePreferred;
  const canOpenInBrowser =
    previewPath !== null &&
    attachment === undefined &&
    !isVideo &&
    isPreviewSupportedInRuntime() &&
    isBrowserPreviewFile(previewPath);
  const absolutePath =
    relativePath && attachment === undefined ? resolvePathLinkTarget(relativePath, cwd) : null;
  const onFilePostRender = useFileLineReveal(relativePath, revealLine, revealRequestId);
  // Board 15: the thread's changed files, the reader's recent files and filter, and the reader's
  // own edits, which save themselves and can be undone.
  const threadKey = scopedThreadKey(threadRef);
  const threadFiles = useThreadFilesContext(threadRef, attachment === undefined ? cwd : "");
  const storedFilter = useUiStateStore((state) => state.filesFilterByThreadKey[threadKey]);
  const storedRecent = useUiStateStore((state) => state.recentFilesByThreadKey[threadKey]);
  const recordRecentFile = useUiStateStore((state) => state.recordRecentFile);
  const setFilesFilter = useUiStateStore((state) => state.setFilesFilter);
  const filesFilter = resolveFilesFilter({
    stored: storedFilter,
    changedCount: threadFiles.changed.length,
  });
  const recentFiles = useMemo(
    () => recentFilesOutsideChanged(storedRecent ?? [], threadFiles.changed, RECENT_FILES_LIMIT),
    [storedRecent, threadFiles.changed],
  );
  const workspaceFile = previewPath !== null && attachment === undefined && !isHostFile;
  useEffect(() => {
    if (workspaceFile && previewPath !== null) recordRecentFile(threadKey, previewPath, null);
  }, [previewPath, recordRecentFile, threadKey, workspaceFile]);
  const changedFile = workspaceFile
    ? (threadFiles.changed.find((entry) => entry.path === previewPath) ?? null)
    : null;
  // The footer speaks for the open file: when the agent changed it, and in which turn.
  const footerCaption =
    previewPath === null || changedFile === null
      ? null
      : threadFiles.latestTurnPaths.has(previewPath)
        ? `Changed by ${threadFiles.agentName} in the latest turn.`
        : "Changed in this thread.";
  // Comments on the open file wait in the composer; the footer counts them and leads there.
  const attachedComments = useComposerDraftStore((store) =>
    workspaceFile && previewPath !== null
      ? fileCommentCount(
          store.getComposerDraft(composerDraftTarget)?.reviewComments ?? [],
          previewPath,
        )
      : 0,
  );
  const editable =
    workspaceFile && !isMedia && !isPdf && file.data !== null && !file.data.truncated;
  const editSession = useFileEditSession({
    environmentId,
    cwd,
    threadKey,
    relativePath: editable ? previewPath : null,
    contents: file.data?.contents ?? null,
    serverContents: editable ? (file.serverData?.contents ?? null) : null,
    turnKey: threadFiles.turnKey,
    onPendingChange,
  });
  // Joined, so typing into a held edit does not hand the explorer a new set on every key.
  const unsavedPathsKey = useFileEditStore((state) =>
    [...heldFilePaths(state.byFileKey, threadKey)].join("\u0000"),
  );
  const unsavedPaths = useMemo(
    () => new Set(unsavedPathsKey.length === 0 ? [] : unsavedPathsKey.split("\u0000")),
    [unsavedPathsKey],
  );
  const viewDiff = useCallback(() => {
    if (!changedFile) return;
    const diffs = useDiffPanelStore.getState();
    if (changedFile.diff.kind === "working-tree") {
      diffs.selectGitScope(threadRef, "uncommitted");
      diffs.requestFocus(threadRef, { kind: "file", path: changedFile.repositoryPath });
    } else {
      diffs.selectTurn(threadRef, changedFile.diff.turnId, changedFile.repositoryPath);
    }
    useRightPanelStore.getState().open(threadRef, "diff");
  }, [changedFile, threadRef]);
  const browseShortcut = shortcutLabelForCommand(keybindings, "filePicker.toggle");
  // Recently opened goes back to the line the file was left at.
  const openFromLists = useCallback(
    (path: string, line: number | null) => {
      if (line === null) onOpenFile(path);
      else useRightPanelStore.getState().openFile(threadRef, path, line);
    },
    [onOpenFile, threadRef],
  );
  useWorkspaceMutationRefresh({
    enabled:
      attachment === undefined &&
      relativePath !== null &&
      // Media and PDFs never show their contents, so re-reading them on every
      // workspace mutation is waste. A folder named like one still re-reads, so
      // it notices when the path becomes a file.
      (isDirectory || (!isMedia && !isPdf)) &&
      !selectedFilePending,
    mutationId: workspaceMutationId,
    refresh: file.refresh,
    resourceKey: `file:${environmentId}:${cwd}:${relativePath ?? ""}`,
  });

  useEffect(() => {
    const currentCrumb = breadcrumbRef.current?.querySelector<HTMLElement>(
      "[data-current-file-crumb='true']",
    );
    currentCrumb?.scrollIntoView({ block: "nearest", inline: "end" });
  }, [relativePath]);

  const copyPath = useCallback(() => {
    if (relativePath === null) return;
    void writeTextToClipboard(relativePath, "path").then(
      () => toastManager.add({ type: "success", title: "Path copied", description: relativePath }),
      (error: unknown) =>
        toastManager.add({
          type: "error",
          title: "Failed to copy path",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
    );
  }, [relativePath]);
  const canOpenInEditor =
    absolutePath !== null &&
    (environmentId === primaryEnvironmentId || remoteOpenState.mode !== "local-exec");

  const handleOpenInBrowser = useCallback(() => {
    if (!absolutePath || !environmentHttpBaseUrl) return;
    void (async () => {
      const result = await openFileInPreview({
        threadRef,
        filePath: absolutePath,
        workspaceRoot: cwd,
        httpBaseUrl: environmentHttpBaseUrl,
        createAssetUrl,
        openPreview,
      });
      if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
        return;
      }
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open file in browser",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    })();
  }, [absolutePath, createAssetUrl, cwd, environmentHttpBaseUrl, openPreview, threadRef]);

  const explorer =
    explorerLayout === "none" ? null : (
      <FileBrowserPanel
        key={`${environmentId}:${cwd}`}
        environmentId={environmentId}
        cwd={cwd}
        projectName={projectName}
        selectedPath={relativePath}
        selectedPathRevealId={revealRequestId}
        onOpenFile={openFromExplorer}
        workspaceMutationId={workspaceMutationId}
        unsavedPaths={unsavedPaths}
        {...(previewPath && !isMedia && !isPdf ? { onRefreshSelectedFile: file.refresh } : {})}
        lists={{
          filter: filesFilter,
          changed: threadFiles.changed,
          recent: recentFiles,
          onFilterChange: (filter) => setFilesFilter(threadKey, filter),
          onOpenFile: openFromLists,
          browseShortcut,
          onBrowseAll: () => openCommandPalette({ open: "files" }),
        }}
      />
    );

  return (
    <div ref={surfaceRef} className="relative flex min-h-0 flex-1 overflow-hidden bg-background">
      {/* Board 15: the explorer is a 252px column on the left, the full height of the tab. */}
      {explorerLayout === "column" ? (
        <aside
          aria-label="File explorer"
          className="flex min-h-0 w-[252px] shrink-0 border-e border-border bg-sidebar"
        >
          {explorer}
        </aside>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {relativePath && attachment === undefined ? (
          <PanelSurfaceHeader
            actions={
              <>
                {/* No save word until the reader edits; then one that says it saved, and Undo. */}
                {editSession.canUndo ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <span className="text-muted-foreground text-xs" aria-live="polite">
                      {editSession.history.tookTheirs
                        ? `Took ${threadFiles.agentName}'s version`
                        : "Your edit saved"}
                    </span>
                    <Button size="compact" variant="ghost" onClick={editSession.undo}>
                      Undo
                    </Button>
                  </span>
                ) : null}
                {changedFile ? (
                  <Button size="compact" variant="outline" onClick={viewDiff}>
                    View diff
                    {changedFile.isNew ? (
                      <span className="text-muted-foreground text-[11px]">new</span>
                    ) : (
                      <DiffStat
                        tone="neutral"
                        notation="full"
                        additions={changedFile.additions}
                        deletions={changedFile.deletions}
                        className="text-[11px] text-muted-foreground"
                      />
                    )}
                  </Button>
                ) : null}
                <FileMoreMenu
                  wordWrap={showsRawText ? wordWrap : null}
                  onWordWrapChange={(next) => updateClientSettings({ wordWrap: next })}
                  rendered={canToggleRendered && renderedMode ? rendered : null}
                  onRenderedChange={(pressed) => {
                    if (pressed === rendered) return;
                    setRenderedPreferred(pressed);
                    setHandledReveal(
                      pressed && relativePath !== null
                        ? { path: relativePath, requestId: revealRequestId }
                        : null,
                    );
                  }}
                  editor={
                    canOpenInEditor && absolutePath
                      ? { environmentId, keybindings, availableEditors, absolutePath }
                      : null
                  }
                  onOpenInBrowser={canOpenInBrowser ? handleOpenInBrowser : null}
                  onCopyPath={copyPath}
                  onKeepAsTab={
                    variant === "files" && previewPath !== null && !isHostFile
                      ? () =>
                          onKeepAsTab(previewPath, viewLineRef.current ?? revealLine ?? undefined)
                      : null
                  }
                >
                  {editSession.canRevert ? (
                    <MenuItem onClick={editSession.revert}>Revert my edits</MenuItem>
                  ) : null}
                </FileMoreMenu>
              </>
            }
          >
            {showsExplorerToggle ? (
              <FileSurfaceAction
                label={explorerOpen ? "Hide files" : "Show files"}
                pressed={explorerOpen}
                onPress={() => setExplorerOpen((current) => !current)}
              >
                <FolderTree className="size-3.5" />
              </FileSurfaceAction>
            ) : null}
            <ScrollArea
              ref={breadcrumbRef}
              hideScrollbars
              scrollFade
              className="min-w-0 flex-1 rounded-none"
              data-file-breadcrumbs
            >
              <div className="flex h-full w-max min-w-full items-center text-xs">
                <FileBreadcrumbs
                  cwd={cwd}
                  environmentId={environmentId}
                  onOpenFile={onOpenFile}
                  projectName={projectName}
                  relativePath={relativePath}
                  workspaceMutationId={workspaceMutationId}
                />
              </div>
            </ScrollArea>
          </PanelSurfaceHeader>
        ) : null}
        {previewPath &&
        attachment === undefined &&
        !isMedia &&
        !renderBrowserFile &&
        file.data?.truncated ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-3 py-1.5 text-muted-foreground text-xs">
            <span className="min-w-0 flex-1">
              {`Showing the first 1 MB of ${formatMegabytes(file.data.byteLength)}.`}
            </span>
            {canOpenInEditor && absolutePath ? (
              <OpenInPicker
                environmentId={environmentId}
                keybindings={keybindings}
                availableEditors={availableEditors}
                openInCwd={absolutePath}
                compact
                enableShortcut={false}
              />
            ) : null}
          </div>
        ) : null}
        {editSession.history.conflict !== null ? (
          // Never lose the reader's edit silently: both versions stay one click away.
          <div
            role="status"
            className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface-raised px-3 py-1.5 text-xs"
          >
            <span className="min-w-0 flex-1">{`${threadFiles.agentName} changed this file too.`}</span>
            <Button size="compact" variant="outline" onClick={editSession.keepMine}>
              Keep mine
            </Button>
            <Button size="compact" variant="ghost" onClick={editSession.takeTheirs}>
              {`Take ${threadFiles.agentName}'s`}
            </Button>
          </div>
        ) : null}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div
            className={cn(
              "min-w-0 flex-1 flex-col overflow-hidden",
              previewPath ? "flex" : "hidden",
            )}
          >
            {isDirectory ? null : relativePath && attachment ? (
              <AttachmentFilePreview
                key={`${environmentId}:${attachment.id}`}
                name={attachment.name}
                mimeType={attachment.mimeType}
                sizeBytes={attachment.sizeBytes}
                asset={{ environmentId, attachmentId: attachment.id }}
              />
            ) : relativePath && isVideo && absolutePath ? (
              <WorkspaceVideoPreview
                key={`${environmentId}:${threadRef.threadId}:${absolutePath}`}
                environmentId={environmentId}
                threadRef={threadRef}
                absolutePath={absolutePath}
                workspaceRoot={cwd}
                name={relativePath}
                workspaceMutationId={workspaceMutationId}
              />
            ) : relativePath && isAudio && absolutePath ? (
              <WorkspaceAudioPreview
                key={`${environmentId}:${threadRef.threadId}:${absolutePath}`}
                environmentId={environmentId}
                threadRef={threadRef}
                absolutePath={absolutePath}
                name={relativePath}
                workspaceMutationId={workspaceMutationId}
              />
            ) : relativePath && isImage && absolutePath ? (
              <WorkspaceImagePreview
                key={absolutePath}
                environmentId={environmentId}
                threadRef={threadRef}
                absolutePath={absolutePath}
                workspaceRoot={cwd}
                alt={relativePath}
                workspaceMutationId={workspaceMutationId}
              />
            ) : relativePath && renderBrowserFile && absolutePath ? (
              <WorkspaceBrowserPreview
                key={absolutePath}
                environmentId={environmentId}
                threadRef={threadRef}
                absolutePath={absolutePath}
                workspaceRoot={cwd}
                title={relativePath}
                workspaceMutationId={workspaceMutationId}
              />
            ) : relativePath && file.error && file.data === null ? (
              <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs leading-relaxed text-destructive">
                {file.error}
              </div>
            ) : relativePath && file.data === null ? (
              <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
                <Spinner className="size-5" />
              </div>
            ) : relativePath && file.data ? (
              isMarkdown && renderMarkdown ? (
                // Markdown reconciles in place across text updates, so a file
                // switch needs a new key or the previous file's disclosure and
                // wrap state carries into the next document.
                <RenderedMarkdownSurface
                  key={relativePath}
                  environmentId={environmentId}
                  cwd={cwd}
                  relativePath={relativePath}
                  threadRef={threadRef}
                  contents={file.data.contents}
                  readOnly={isHostFile}
                  onEdit={editSession.edit}
                />
              ) : tableDelimiter && renderTable ? (
                <DelimitedTablePreview
                  key={relativePath}
                  name={relativePath}
                  text={file.data.contents}
                  delimiter={tableDelimiter}
                />
              ) : file.data.truncated || isHostFile ? (
                <SourceFilePreview
                  name={relativePath}
                  text={file.data.contents}
                  cacheKey={projectFileCacheKey(cwd, relativePath, file.data.contents)}
                  onPostRender={onFilePostRender}
                />
              ) : (
                <DiffWorkerPoolProvider>
                  <EditableFileSurface
                    key={`${relativePath}:${resolvedTheme}`}
                    environmentId={environmentId}
                    cwd={cwd}
                    relativePath={relativePath}
                    composerDraftTarget={composerDraftTarget}
                    contents={file.data.contents}
                    resolvedTheme={resolvedTheme}
                    revealRequestId={revealRequestId}
                    wordWrap={wordWrap}
                    onPostRender={onFilePostRender}
                    onEdit={editSession.edit}
                    viewLineRef={viewLineRef}
                    onLeave={(line) => {
                      if (line !== null) recordRecentFile(threadKey, relativePath, line);
                    }}
                  />
                </DiffWorkerPoolProvider>
              )
            ) : null}
          </div>
          {explorerLayout === "fill" ? <div className="flex min-w-0 flex-1">{explorer}</div> : null}
          {explorerLayout === "overlay" ? (
            <aside
              aria-label="File explorer"
              className="absolute inset-y-0 start-0 z-10 flex w-[252px] max-w-[85%] border-e border-border bg-sidebar shadow-lg"
            >
              {explorer}
            </aside>
          ) : null}
        </div>
        {footerCaption !== null || attachedComments > 0 ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-t border-border bg-surface-raised px-3 py-2">
            <span className="min-w-0 flex-1 basis-[200px] text-muted-foreground text-xs">
              {footerCaption}
            </span>
            <AttachedCountButton count={attachedComments} kind="comment" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
