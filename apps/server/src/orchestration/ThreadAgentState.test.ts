import { describe, expect, it } from "vite-plus/test";
import { make } from "./ThreadAgentState.ts";

describe("ThreadAgentStateService", () => {
  it("reports only real changes so ingestion re-asserts the session once", () => {
    const registry = make();
    expect(registry.setThreadAgentState("t", { kind: "retrying", attempt: 1 })).toBe(true);
    expect(registry.setThreadAgentState("t", { kind: "retrying", attempt: 1 })).toBe(false);
    expect(registry.setThreadAgentState("t", { kind: "retrying", attempt: 2 })).toBe(true);
    expect(registry.getThreadAgentState("t")).toEqual({ kind: "retrying", attempt: 2 });
    expect(registry.setThreadAgentState("t", null)).toBe(true);
    expect(registry.setThreadAgentState("t", null)).toBe(false);
    expect(registry.getThreadAgentState("t")).toBeNull();
  });
});
