import { describe, expect, it, vi } from "vite-plus/test";

import {
  AgentImportedCookieAccessDeniedError,
  agentImportedCookieApprovalMessage,
  ensureAgentImportedCookieAccess,
} from "./agentImportedCookieApproval";

const access = {
  holdsImportedCookies: true,
  approved: false,
  browserName: "Chrome",
  profileId: "work",
};

describe("ensureAgentImportedCookieAccess", () => {
  it("names the browser and profile in the confirm dialog", () => {
    expect(
      agentImportedCookieApprovalMessage({ browserName: "Chrome", profileName: "Work" }),
    ).toContain("Chrome");
    expect(
      agentImportedCookieApprovalMessage({ browserName: "Chrome", profileName: "Work" }),
    ).toContain("Work");
  });

  it("does not grant when the partition has no imported cookies", async () => {
    const grant = vi.fn(async () => undefined);
    const confirm = vi.fn(async () => true);
    await ensureAgentImportedCookieAccess({
      bridge: {
        agentImportedCookieAccess: async () => ({
          ...access,
          holdsImportedCookies: false,
          approved: false,
        }),
        grantAgentImportedCookieAccess: grant,
      },
      tabId: "tab-1",
      profileName: (id) => id,
      confirm,
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled();
  });

  it("rejects without granting when the user declines", async () => {
    const grant = vi.fn(async () => undefined);
    await expect(
      ensureAgentImportedCookieAccess({
        bridge: {
          agentImportedCookieAccess: async () => access,
          grantAgentImportedCookieAccess: grant,
        },
        tabId: "tab-1",
        profileName: () => "Work",
        confirm: async (message) => {
          expect(message).toContain("Chrome");
          expect(message).toContain("Work");
          return false;
        },
      }),
    ).rejects.toBeInstanceOf(AgentImportedCookieAccessDeniedError);
    expect(grant).not.toHaveBeenCalled();
  });

  it("grants only after the user confirms", async () => {
    const grant = vi.fn(async () => undefined);
    await ensureAgentImportedCookieAccess({
      bridge: {
        agentImportedCookieAccess: async () => access,
        grantAgentImportedCookieAccess: grant,
      },
      tabId: "tab-1",
      profileName: () => "Work",
      confirm: async () => true,
    });
    expect(grant).toHaveBeenCalledExactlyOnceWith("tab-1");
  });

  it("does not ask again after this tab is already approved", async () => {
    const grant = vi.fn(async () => undefined);
    const confirm = vi.fn(async () => true);
    await ensureAgentImportedCookieAccess({
      bridge: {
        agentImportedCookieAccess: async () => ({ ...access, approved: true }),
        grantAgentImportedCookieAccess: grant,
      },
      tabId: "tab-1",
      profileName: () => "Work",
      confirm,
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled();
  });
});
