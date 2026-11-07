import { describe, expect, it } from "vite-plus/test";

import { resolveSubagentSplit } from "./subagentSplit.ts";

describe("resolveSubagentSplit", () => {
  const supported = { supportsSubagentSplit: true };

  it("offers the split only on a new thread with a supporting provider", () => {
    expect(
      resolveSubagentSplit({ isNewThread: true, provider: supported, requested: undefined }),
    ).toEqual({ available: true, enabled: false });
    expect(
      resolveSubagentSplit({ isNewThread: true, provider: supported, requested: true }),
    ).toEqual({ available: true, enabled: true });
    expect(
      resolveSubagentSplit({ isNewThread: false, provider: supported, requested: true }),
    ).toEqual({ available: false, enabled: false });
  });

  it("drops a remembered choice after switching to a provider without subagents", () => {
    expect(resolveSubagentSplit({ isNewThread: true, provider: {}, requested: true })).toEqual({
      available: false,
      enabled: false,
    });
    expect(resolveSubagentSplit({ isNewThread: true, provider: null, requested: true })).toEqual({
      available: false,
      enabled: false,
    });
  });
});
