import { describe, expect, it } from "vite-plus/test";

import {
  completeImportedCookieApprovalClose,
  readImportedCookieApprovalState,
  registerImportedCookieApprovalHost,
  requestImportedCookieApproval,
  respondToImportedCookieApproval,
} from "./importedCookieApprovalDialog";

describe("requestImportedCookieApproval", () => {
  it("fails closed without a host and does not queue a second prompt", async () => {
    await expect(requestImportedCookieApproval("first")).resolves.toBe(false);

    const release = registerImportedCookieApprovalHost();
    const first = requestImportedCookieApproval("Allow the agent to use cookies?");
    const second = requestImportedCookieApproval("second");
    await expect(second).resolves.toBe(false);
    expect(readImportedCookieApprovalState()).toMatchObject({
      status: "confirming",
      message: "Allow the agent to use cookies?",
    });

    respondToImportedCookieApproval(false);
    await expect(first).resolves.toBe(false);
    completeImportedCookieApprovalClose();
    expect(readImportedCookieApprovalState().status).toBe("idle");
    release();
  });
});
