import { PROVIDER_APPROVAL_FEEDBACK_MAX_CHARS, type ServerProvider } from "@e6tools/contracts";

/**
 * Names the agent that decline instructions go to, or null when the provider's
 * server cannot take them (older servers drop the field without an error).
 */
export function approvalFeedbackAgentName(
  provider: Pick<ServerProvider, "displayName" | "supportsApprovalFeedback"> | null | undefined,
): string | null {
  if (provider?.supportsApprovalFeedback !== true) return null;
  return provider.displayName ?? "the agent";
}

export type ApprovalFeedbackDraft =
  | { readonly status: "empty" }
  | { readonly status: "too-long"; readonly maxChars: number }
  | { readonly status: "ready"; readonly feedback: string };

/** Reads typed instructions the way the server will decode them. */
export function readApprovalFeedbackDraft(text: string): ApprovalFeedbackDraft {
  const feedback = text.trim();
  if (feedback.length === 0) return { status: "empty" };
  if (feedback.length > PROVIDER_APPROVAL_FEEDBACK_MAX_CHARS) {
    return { status: "too-long", maxChars: PROVIDER_APPROVAL_FEEDBACK_MAX_CHARS };
  }
  return { status: "ready", feedback };
}
