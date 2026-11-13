import type { ScopedThreadRef } from "@e6tools/contracts";
import { htmlRenderFileName } from "@e6tools/shared/htmlRender";
import { AppWindowIcon, FileIcon } from "lucide-react";

import { useRightPanelStore } from "~/rightPanelStore";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import type { ThreadArtifact } from "./threadArtifacts";

function openArtifact(threadRef: ScopedThreadRef, artifact: ThreadArtifact) {
  const store = useRightPanelStore.getState();
  if (artifact.kind === "file") {
    store.openFile(threadRef, artifact.path);
    return;
  }
  store.openAttachment(threadRef, {
    type: "file",
    id: artifact.htmlRender.attachmentId,
    name: htmlRenderFileName(artifact.title),
    mimeType: "text/html",
    // Unknown on the client; the file view hides a size it cannot show.
    sizeBytes: 0,
  });
}

/** The thread's artifacts in one place: published pages and viewable files its turns changed. */
export function ThreadArtifactsPanel(props: {
  readonly threadRef: ScopedThreadRef;
  readonly artifacts: ReadonlyArray<ThreadArtifact>;
}) {
  if (props.artifacts.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs leading-relaxed text-muted-foreground">
        No artifacts yet. Pages an agent renders and pages, images, PDFs or diagrams it writes
        appear here.
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      <ul aria-label="Thread artifacts" className="flex flex-col gap-0.5">
        {props.artifacts.map((artifact) => {
          const Icon = artifact.kind === "page" ? AppWindowIcon : FileIcon;
          return (
            <li key={artifact.key}>
              <button
                type="button"
                className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => openArtifact(props.threadRef, artifact)}
              >
                <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{artifact.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {artifact.kind === "page" ? "Rendered page" : artifact.path}
                  </span>
                </span>
                <time
                  dateTime={artifact.createdAt}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  {formatRelativeTimeLabel(artifact.createdAt)}
                </time>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
