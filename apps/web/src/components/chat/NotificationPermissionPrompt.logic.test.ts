import { describe, expect, it } from "vite-plus/test";

import {
  NOTIFICATION_PROMPT_SNOOZE_MS,
  shouldOfferNotificationPermission,
} from "./NotificationPermissionPrompt.logic";

const base = {
  supported: true,
  permission: "default",
  attentionNotifications: "blocked",
  notNowAtMs: null,
  nowMs: 1_000_000_000,
} as const;

describe("shouldOfferNotificationPermission", () => {
  it("asks while the browser has not decided", () => {
    expect(shouldOfferNotificationPermission(base)).toBe(true);
  });

  it.each([
    ["granted", { permission: "granted" }],
    ["denied", { permission: "denied" }],
    ["unsupported", { supported: false, permission: null }],
    ["notifications off", { attentionNotifications: "off" }],
  ] as const)("does not ask when %s", (_case, overrides) => {
    expect(shouldOfferNotificationPermission({ ...base, ...overrides })).toBe(false);
  });

  it("stays quiet for 7 days after Not now", () => {
    const notNowAtMs = base.nowMs - NOTIFICATION_PROMPT_SNOOZE_MS + 1;
    expect(shouldOfferNotificationPermission({ ...base, notNowAtMs })).toBe(false);
    expect(shouldOfferNotificationPermission({ ...base, notNowAtMs: notNowAtMs - 1 })).toBe(true);
  });
});
