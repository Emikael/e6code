import { describe, expect, it } from "vite-plus/test";

import { shouldHandleAppLink } from "./appLinking";

describe("shouldHandleAppLink", () => {
  it.each([
    "e6code://",
    "e6code:///",
    "e6code-dev://",
    "e6code-preview://",
    "e6code://",
    "e6code:///",
    "e6code-dev://",
    "e6code-preview://",
  ])("ignores scheme-only URL %s", (url) => {
    expect(shouldHandleAppLink(url)).toBe(false);
  });

  it.each([
    "e6code://threads/env-1/thread-1",
    "e6code://pair?pairingUrl=x",
    "e6code-dev://settings/usage?tab=limits",
    "e6code://threads/env-1/thread-1",
    "e6code-dev://pair?pairingUrl=x",
    "e6code-preview://settings/usage?tab=limits",
  ])("handles path-bearing URL %s", (url) => {
    expect(shouldHandleAppLink(url)).toBe(true);
  });

  it.each(["e6code://expo-development-client/?url=x", "e6code://expo-sharing/anything"])(
    "ignores lifecycle URL %s",
    (url) => {
      expect(shouldHandleAppLink(url)).toBe(false);
    },
  );
});
