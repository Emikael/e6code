import type { PreviewSessionSnapshot, ProjectScript } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  addressFieldLabel,
  getConfiguredPreviewUrls,
  shouldShowPreviewEmptyState,
} from "./previewEmptyStateLogic";

const snapshot = (navStatus: PreviewSessionSnapshot["navStatus"]): PreviewSessionSnapshot => ({
  threadId: "thread-1",
  tabId: "tab-1",
  navStatus,
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-06-12T20:00:00.000Z",
});

describe("shouldShowPreviewEmptyState", () => {
  it("shows quick-open options for a new idle browser tab", () => {
    expect(shouldShowPreviewEmptyState(snapshot({ _tag: "Idle" }))).toBe(true);
  });

  it("shows browser content once navigation starts", () => {
    expect(
      shouldShowPreviewEmptyState(
        snapshot({ _tag: "Loading", url: "http://localhost:5173", title: "" }),
      ),
    ).toBe(false);
  });
});

describe("getConfiguredPreviewUrls", () => {
  it("collects configured preview URLs from project scripts", () => {
    const scripts = [
      { previewUrl: "http://localhost:5173" },
      {},
      { previewUrl: "http://localhost:3000" },
    ] as ProjectScript[];

    expect(getConfiguredPreviewUrls(scripts)).toEqual([
      "http://localhost:5173",
      "http://localhost:3000",
    ]);
  });
});

describe("addressFieldLabel", () => {
  it("shows a web address without its scheme while the field is at rest", () => {
    expect(addressFieldLabel("http://localhost:5733/settings/attention")).toBe(
      "localhost:5733/settings/attention",
    );
    expect(addressFieldLabel("https://example.com/?q=1")).toBe("example.com/?q=1");
  });

  it("keeps any other scheme, which says something the address would not", () => {
    expect(addressFieldLabel("file:///tmp/index.html")).toBe("file:///tmp/index.html");
    expect(addressFieldLabel("")).toBe("");
  });
});
