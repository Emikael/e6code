import type { TurnId } from "@e6tools/contracts";
import type { HtmlRenderReference } from "@e6tools/shared/htmlRender";

import type { WorkLogEntry } from "../../session-logic";
import type { TurnDiffSummary } from "../../types";

/** Files a turn changed that open as something to look at rather than code to read. */
const ARTIFACT_FILE_EXTENSION = /\.(?:html?|svg|pdf|png|jpe?g|gif|webp|mmd|mermaid)$/i;

export type ThreadArtifact =
  | {
      readonly kind: "page";
      readonly key: string;
      readonly title: string;
      readonly createdAt: string;
      readonly turnId: TurnId | null;
      readonly htmlRender: HtmlRenderReference;
    }
  | {
      readonly kind: "file";
      readonly key: string;
      readonly title: string;
      readonly createdAt: string;
      readonly turnId: TurnId;
      readonly path: string;
    };

function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

/**
 * Everything a thread produced to look at, newest first: pages published with `html_render`, and
 * viewable files (pages, images, PDFs, diagrams) its turns changed. A file changed in several
 * turns is listed once, at its latest change.
 */
export function deriveThreadArtifacts(input: {
  readonly workEntries: ReadonlyArray<WorkLogEntry>;
  readonly turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
}): ThreadArtifact[] {
  const artifacts: ThreadArtifact[] = [];
  const seenPages = new Set<string>();
  for (const entry of input.workEntries) {
    const htmlRender = entry.htmlRender;
    if (!htmlRender || seenPages.has(htmlRender.attachmentId)) continue;
    seenPages.add(htmlRender.attachmentId);
    artifacts.push({
      kind: "page",
      key: `page:${htmlRender.attachmentId}`,
      title: htmlRender.title,
      createdAt: entry.createdAt,
      turnId: entry.turnId ?? null,
      htmlRender,
    });
  }
  const latestFileByPath = new Map<string, Extract<ThreadArtifact, { kind: "file" }>>();
  for (const summary of input.turnDiffSummaries) {
    for (const file of summary.files) {
      // Checkpoint files are all "modified"; one that only lost lines was most likely deleted.
      const removed = file.additions === 0 && file.deletions > 0;
      if (!ARTIFACT_FILE_EXTENSION.test(file.path) || removed) continue;
      const previous = latestFileByPath.get(file.path);
      if (previous && previous.createdAt >= summary.completedAt) continue;
      latestFileByPath.set(file.path, {
        kind: "file",
        key: `file:${file.path}`,
        title: fileName(file.path),
        createdAt: summary.completedAt,
        turnId: summary.turnId,
        path: file.path,
      });
    }
  }
  artifacts.push(...latestFileByPath.values());
  return artifacts.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
}
