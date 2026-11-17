/**
 * What a replay adapter declares per provider: the capabilities the real
 * adapter reports and the event it ends an interrupted turn with. Each entry
 * cites the real adapter so the two can be kept in step until one table
 * (E37-T11's capability matrix) feeds both.
 *
 * @module provider/replay/replayProfiles
 */
import { ProviderDriverKind } from "@e6tools/contracts";

import type { ProviderAdapterCapabilities } from "../Services/ProviderAdapter.ts";

/** How a provider reports a turn the user interrupted. */
export type ReplayInterruptTerminal = "completed-interrupted" | "completed-cancelled" | "aborted";

export interface ReplayProfile {
  readonly capabilities: ProviderAdapterCapabilities;
  readonly interruptTerminal: ReplayInterruptTerminal;
  /** False when startSession accepts any `input.provider` (OpenCode). */
  readonly validatesProviderMismatch: boolean;
}

const profiles: Readonly<Record<string, ReplayProfile>> = {
  // CodexAdapter.ts capabilities block and completeTurn mapping. Whether an
  // interrupt surfaces as turn.completed or turn.aborted is unconfirmed.
  codex: {
    capabilities: { sessionModelSwitch: "in-session", promptlessTurnContinuation: true },
    interruptTerminal: "completed-interrupted",
    validatesProviderMismatch: true,
  },
  // ClaudeAdapter.ts: approvalFeedback native; completeTurn("interrupted").
  claudeAgent: {
    capabilities: { sessionModelSwitch: "in-session", approvalFeedback: "native" },
    interruptTerminal: "completed-interrupted",
    validatesProviderMismatch: true,
  },
  // CursorAdapter.ts: no rollback; cancelled turns complete as "cancelled".
  cursor: {
    capabilities: { sessionModelSwitch: "in-session", supportsConversationRollback: false },
    interruptTerminal: "completed-cancelled",
    validatesProviderMismatch: true,
  },
  // GrokAdapter.ts: no rollback; cancelled turns complete as "cancelled".
  grok: {
    capabilities: { sessionModelSwitch: "in-session", supportsConversationRollback: false },
    interruptTerminal: "completed-cancelled",
    validatesProviderMismatch: true,
  },
  // OpenCodeAdapter.ts: approvalFeedback native; aborts emit turn.aborted;
  // startSession has no provider mismatch check.
  opencode: {
    capabilities: { sessionModelSwitch: "in-session", approvalFeedback: "native" },
    interruptTerminal: "aborted",
    validatesProviderMismatch: false,
  },
  // AntigravityAdapter.ts: no rollback; cancelled turns complete as "cancelled".
  antigravity: {
    capabilities: { sessionModelSwitch: "in-session", supportsConversationRollback: false },
    interruptTerminal: "completed-cancelled",
    validatesProviderMismatch: true,
  },
};

const fallbackProfile: ReplayProfile = {
  capabilities: { sessionModelSwitch: "in-session" },
  interruptTerminal: "completed-interrupted",
  validatesProviderMismatch: true,
};

export const REPLAY_PROVIDERS: ReadonlyArray<ProviderDriverKind> = Object.keys(profiles).map(
  (kind) => ProviderDriverKind.make(kind),
);

export function replayProfileFor(provider: ProviderDriverKind): ReplayProfile {
  return profiles[provider] ?? fallbackProfile;
}
