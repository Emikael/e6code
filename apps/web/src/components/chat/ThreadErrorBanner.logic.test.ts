import { describe, expect, it } from "vite-plus/test";

import { failureRemedy } from "./ThreadErrorBanner.logic";

describe("failureRemedy", () => {
  it("takes the command the provider's error names", () => {
    expect(
      failureRemedy({
        error: "Turn failed.\nCodex CLI is not authenticated. Run `codex login` and try again.",
        providerMessage: null,
        canRetry: true,
      }),
    ).toEqual({ kind: "command", command: "codex login" });
  });

  it("falls back to the command in the provider's status", () => {
    expect(
      failureRemedy({
        error: "Process exited with code 1",
        providerMessage:
          "Claude could not authenticate. For subscription login, run `claude auth login` on this environment's machine, then start a new thread.",
        canRetry: true,
      }),
    ).toEqual({ kind: "command", command: "claude auth login" });
  });

  it("says what Retry does when no fix is known, and nothing without Retry", () => {
    const unknown = { error: "Connection reset", providerMessage: "Ready" };
    expect(failureRemedy({ ...unknown, canRetry: true })).toEqual({ kind: "retry" });
    expect(failureRemedy({ ...unknown, canRetry: false })).toBeNull();
  });
});
