import { MessageId, type OrchestrationMessage, type TurnId } from "@e6tools/contracts";
import { readHtmlRenderReference } from "@e6tools/shared/htmlRender";

/**
 * The feed shows a turn's published pages above its final reply. A turn that published a page
 * without replying gets an empty placeholder reply to carry them, timed at its last page.
 */
export function htmlRenderPlaceholderMessages(
  messages: ReadonlyArray<Pick<OrchestrationMessage, "role" | "turnId">>,
  activities: ReadonlyArray<{
    readonly turnId: TurnId | null;
    readonly createdAt: string;
    readonly payload: unknown;
  }>,
): OrchestrationMessage[] {
  const repliedTurnIds = new Set(
    messages.flatMap((message) =>
      message.role === "assistant" && message.turnId ? [message.turnId] : [],
    ),
  );
  const lastPageAtByTurnId = new Map<TurnId, string>();
  for (const activity of activities) {
    if (!activity.turnId || repliedTurnIds.has(activity.turnId)) continue;
    const payload = activity.payload as { readonly htmlRender?: unknown } | null;
    if (!readHtmlRenderReference(payload?.htmlRender)) continue;
    const previous = lastPageAtByTurnId.get(activity.turnId);
    if (!previous || activity.createdAt > previous) {
      lastPageAtByTurnId.set(activity.turnId, activity.createdAt);
    }
  }
  return [...lastPageAtByTurnId].map(([turnId, createdAt]) => ({
    id: MessageId.make(`html-render-placeholder:${turnId}`),
    role: "assistant",
    text: "",
    turnId,
    streaming: false,
    createdAt,
    updatedAt: createdAt,
  }));
}
