import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/models";
import type { ThreadAttentionItem } from "@e6tools/client-runtime/state/thread-attention";
import { describe, expect, it } from "vite-plus/test";

import { nothingNeedsYouMessage } from "./needsYouNavigation";

const item = (key: string) => ({ key }) as ThreadAttentionItem<EnvironmentThreadShell>;

describe("nothingNeedsYouMessage", () => {
  it("says nothing else needs you when only the open thread is waiting", () => {
    expect(nothingNeedsYouMessage({ blocked: [item("a")], earlier: [], review: [] }, "a")).toBe(
      "Nothing else needs you",
    );
    expect(nothingNeedsYouMessage({ blocked: [], earlier: [], review: [item("a")] }, "a")).toBe(
      "Nothing else needs you",
    );
  });

  it("says nothing needs you when nothing is waiting", () => {
    expect(nothingNeedsYouMessage({ blocked: [], earlier: [], review: [] }, "a")).toBe(
      "Nothing needs you",
    );
    expect(nothingNeedsYouMessage({ blocked: [], earlier: [], review: [] }, null)).toBe(
      "Nothing needs you",
    );
  });
});
