import type { EnvironmentId, ScopedThreadRef } from "@e6tools/contracts";
import {
  htmlRenderFileName,
  htmlRenderFrameHeight,
  type HtmlRenderReference,
  htmlRenderThemeFragment,
  htmlRenderThemeMessage,
  readHtmlRenderContentHeight,
  readHtmlRenderLinkRequest,
} from "@e6tools/shared/htmlRender";
import { DownloadIcon, Maximize2Icon, PanelRightIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAssetUrlRefresh, useAssetUrlState } from "~/assets/assetUrls";
import { useHtmlRenderTheme } from "~/hooks/useHtmlRenderTheme";
import { readLocalApi } from "~/localApi";
import { useRightPanelStore } from "~/rightPanelStore";

import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

// Same sandbox as the server's CSP for HTML assets: scripts run on an opaque origin, without
// the app's cookies, storage, or API.
const FRAME_SANDBOX = "allow-scripts allow-forms allow-popups allow-modals";
// Mount frames a little before they scroll into view; long threads keep idle pages unloaded.
const MOUNT_ROOT_MARGIN = "600px 0px";

// The timeline is virtualized, so a frame remounts when scrolled back to. Remember each page's
// measured height so the row opens at its real size instead of jumping from the agent's hint.
const MAX_REMEMBERED_HEIGHTS = 200;
const contentHeightByAttachmentId = new Map<string, number>();
function rememberContentHeight(attachmentId: string, height: number) {
  contentHeightByAttachmentId.delete(attachmentId);
  contentHeightByAttachmentId.set(attachmentId, height);
  if (contentHeightByAttachmentId.size > MAX_REMEMBERED_HEIGHTS) {
    const oldest = contentHeightByAttachmentId.keys().next().value;
    if (oldest !== undefined) contentHeightByAttachmentId.delete(oldest);
  }
}

function openExternalLink(url: string) {
  const localApi = readLocalApi();
  if (localApi) {
    void localApi.shell.openExternal(url).catch(() => window.open(url, "_blank", "noopener"));
    return;
  }
  window.open(url, "_blank", "noopener");
}

/**
 * One artifact page. Fits its height to the page, follows the app theme, and forwards http(s)
 * link clicks to the host. Used inline in the timeline and in the full-screen dialog.
 */
function HtmlRenderDocument(props: {
  readonly src: string;
  readonly title: string;
  readonly className?: string;
  readonly onContentHeight?: (height: number) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const theme = useHtmlRenderTheme();
  // The first load takes the theme from the URL fragment; later changes go by message, so a
  // theme switch does not reload the page.
  const [initialSrc] = useState(() => `${props.src}${htmlRenderThemeFragment(theme)}`);
  const { onContentHeight } = props;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const height = readHtmlRenderContentHeight(event.data);
      if (height !== undefined) {
        onContentHeight?.(height);
        return;
      }
      const link = readHtmlRenderLinkRequest(event.data);
      if (link) openExternalLink(link.url);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onContentHeight]);

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage(htmlRenderThemeMessage(theme), "*");
  }, [theme]);

  return (
    <iframe
      ref={frameRef}
      src={initialSrc}
      title={props.title}
      sandbox={FRAME_SANDBOX}
      className={props.className}
      onLoad={() =>
        frameRef.current?.contentWindow?.postMessage(htmlRenderThemeMessage(theme), "*")
      }
    />
  );
}

function HtmlRenderDialog(props: {
  readonly src: string;
  readonly title: string;
  readonly onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup
        variant="media"
        showCloseButton={false}
        bottomStickOnMobile={false}
        className="row-start-1"
        initialFocus={closeButtonRef}
      >
        <DialogTitle className="sr-only">{props.title}, full screen</DialogTitle>
        <div className="relative w-[92vw]">
          <Button
            ref={closeButtonRef}
            aria-label="Close"
            size="icon-xs"
            variant="media-close"
            className="absolute right-0 -top-10 z-20"
            onClick={props.onClose}
          >
            <XIcon />
          </Button>
          <div className="h-[min(86vh,calc(100vh-160px))] overflow-hidden rounded-lg bg-background shadow-2xl ring-1 ring-border/70">
            <HtmlRenderDocument src={props.src} title={props.title} className="block size-full" />
          </div>
          <p className="mt-2 truncate text-center text-xs text-white/80">{props.title}</p>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function ToolbarButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button aria-label={props.label} size="icon-xs" variant="glass" onClick={props.onClick} />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/** Inline artifact in an assistant reply, with full screen, side panel, and download actions. */
export function HtmlRenderFrame(props: {
  readonly environmentId: EnvironmentId;
  readonly htmlRender: HtmlRenderReference;
  readonly threadRef: ScopedThreadRef | undefined;
}) {
  const { attachmentId, title } = props.htmlRender;
  const fileName = htmlRenderFileName(title);
  const boxRef = useRef<HTMLDivElement>(null);
  // Without IntersectionObserver there is no cheap way to defer, so mount right away.
  const [nearViewport, setNearViewport] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  const [contentHeight, setContentHeight] = useState(() =>
    contentHeightByAttachmentId.get(attachmentId),
  );
  const onContentHeight = useCallback(
    (height: number) => {
      rememberContentHeight(attachmentId, height);
      setContentHeight(height);
    },
    [attachmentId],
  );
  const [expandedSrc, setExpandedSrc] = useState<string | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || nearViewport) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNearViewport(true);
      },
      { rootMargin: MOUNT_ROOT_MARGIN },
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [nearViewport]);

  const resource = useMemo(
    () => ({
      _tag: "attachment" as const,
      attachmentId,
      fileName,
      mimeType: "text/html",
      disposition: "inline" as const,
    }),
    [attachmentId, fileName],
  );
  const downloadResource = useMemo(
    () => ({ ...resource, disposition: "attachment" as const }),
    [resource],
  );
  const assetUrl = useAssetUrlState(nearViewport ? props.environmentId : null, resource);
  // Keep the first URL: a re-minted URL would reload the page and lose its state.
  const [src, setSrc] = useState<string | null>(null);
  if (src === null && assetUrl._tag === "Success") setSrc(assetUrl.url);
  const refresh = useAssetUrlRefresh(props.environmentId, resource);
  const refreshDownload = useAssetUrlRefresh(props.environmentId, downloadResource);

  const reportUnavailable = () =>
    toastManager.add({
      type: "error",
      title: "Page unavailable",
      description: "Reconnect to the environment and try again.",
    });
  const openFullScreen = async () => {
    // Asset URLs expire; the dialog loads a fresh one.
    const url = await refresh().catch(() => null);
    if (url !== null) setExpandedSrc(url);
    else reportUnavailable();
  };
  const download = async () => {
    const url = await refreshDownload().catch(() => null);
    if (url === null) return reportUnavailable();
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
  };
  const openInPanel = () => {
    if (!props.threadRef) return;
    useRightPanelStore.getState().openAttachment(props.threadRef, {
      type: "file",
      id: attachmentId,
      name: fileName,
      mimeType: "text/html",
      // Unknown on the client; the file view hides a size it cannot show.
      sizeBytes: 0,
    });
  };

  const height = htmlRenderFrameHeight(props.htmlRender, contentHeight);
  return (
    <figure
      ref={boxRef}
      className="group/html-render relative my-2 overflow-hidden rounded-lg"
      style={{ height }}
      aria-label={title}
    >
      {src !== null ? (
        <HtmlRenderDocument
          src={src}
          title={title}
          className="block size-full border-0"
          onContentHeight={onContentHeight}
        />
      ) : assetUrl._tag === "Failure" ? (
        <p className="flex size-full items-center justify-center text-muted-foreground text-xs">
          Unable to load {title}
        </p>
      ) : (
        <div className="size-full rounded-lg bg-muted/40" aria-hidden />
      )}
      {src !== null ? (
        <div className="absolute end-2 top-2 flex gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/html-render:opacity-100 pointer-coarse:opacity-100">
          {props.threadRef ? (
            <ToolbarButton label="Open in side panel" onClick={openInPanel}>
              <PanelRightIcon className="size-3.5" />
            </ToolbarButton>
          ) : null}
          <ToolbarButton label="Download HTML" onClick={() => void download()}>
            <DownloadIcon className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Open full screen" onClick={() => void openFullScreen()}>
            <Maximize2Icon className="size-3.5" />
          </ToolbarButton>
        </div>
      ) : null}
      {expandedSrc !== null ? (
        <HtmlRenderDialog src={expandedSrc} title={title} onClose={() => setExpandedSrc(null)} />
      ) : null}
    </figure>
  );
}
