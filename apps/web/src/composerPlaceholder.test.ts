import { describe, expect, it } from "vite-plus/test";

import {
  DISCONNECTED_COMPOSER_PLACEHOLDER,
  resolveComposerPlaceholder,
} from "./composerPlaceholder";

const idle = {
  approval: null,
  pendingQuestion: null,
  planFollowUp: false,
  projectSelectionRequired: false,
  providerUnavailable: false,
  phase: "ready",
} as const;

describe("resolveComposerPlaceholder", () => {
  it("invites a queued follow-up while a turn runs, and the usual prompt when idle", () => {
    expect(resolveComposerPlaceholder({ ...idle, phase: "running" })).toBe(
      "Queue a follow-up while it works",
    );
    expect(resolveComposerPlaceholder(idle)).toBe(
      "Ask anything, @tag files/folders, $use skills, or / for commands",
    );
    expect(resolveComposerPlaceholder({ ...idle, phase: "disconnected" })).toBe(
      DISCONNECTED_COMPOSER_PLACEHOLDER,
    );
  });

  it("invites a reply or a parked thought in focus mode, unless a turn runs", () => {
    expect(resolveComposerPlaceholder({ ...idle, focusMode: true })).toBe(
      "Reply, or park a thought for later",
    );
    expect(resolveComposerPlaceholder({ ...idle, phase: "running", focusMode: true })).toBe(
      "Queue a follow-up while it works",
    );
  });

  it("lets a blocking approval or question win over a running turn", () => {
    expect(
      resolveComposerPlaceholder({ ...idle, phase: "running", approval: { agentName: "Claude" } }),
    ).toBe("Tell Claude what to do instead…");
    expect(
      resolveComposerPlaceholder({ ...idle, phase: "running", approval: { agentName: null } }),
    ).toBe("Resolve this approval request to continue");
    expect(
      resolveComposerPlaceholder({
        ...idle,
        phase: "running",
        pendingQuestion: { choiceOnly: true },
      }),
    ).toBe("Choose an option above");
  });
});
