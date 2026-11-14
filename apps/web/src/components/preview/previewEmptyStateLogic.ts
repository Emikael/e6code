import type { PreviewSessionSnapshot, ProjectScript } from "@e6tools/contracts";

export function shouldShowPreviewEmptyState(snapshot: PreviewSessionSnapshot | null): boolean {
  return snapshot === null || snapshot.navStatus._tag === "Idle";
}

export function getConfiguredPreviewUrls(
  scripts: ReadonlyArray<ProjectScript> | undefined,
): ReadonlyArray<string> {
  return scripts?.flatMap((script) => (script.previewUrl ? [script.previewUrl] : [])) ?? [];
}

/**
 * The address as the field shows it at rest (board 17): "localhost:5733/settings/attention",
 * without an http or https scheme. Focusing the field shows the full address to edit.
 */
export function addressFieldLabel(url: string): string {
  return url.replace(/^https?:\/\//i, "");
}
