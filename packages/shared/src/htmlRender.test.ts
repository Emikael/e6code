import { describe, expect, it } from "vite-plus/test";

import {
  findHtmlRenderViewportHeightUnit,
  htmlRenderFrameHeight,
  htmlRendersByTurnId,
  injectHtmlRenderBootstrap,
  readHtmlRenderContentHeight,
  readHtmlRenderLinkRequest,
  readHtmlRenderReference,
} from "./htmlRender.ts";

const reference = { attachmentId: "thread-abc-123-html", title: "Chart", height: 420 };

describe("injectHtmlRenderBootstrap", () => {
  it("puts the theme ahead of the page's own head content", () => {
    const html =
      "<!doctype html><html><head><style>:root{--background:red}</style></head><body>x</body></html>";
    const injected = injectHtmlRenderBootstrap(html);
    const themeAt = injected.indexOf('<style id="e6-theme">');
    expect(themeAt).toBeGreaterThan(injected.indexOf("<head>"));
    expect(themeAt).toBeLessThan(injected.indexOf(":root{--background:red}"));
    expect(injected).toContain('<meta charset="utf-8">');
  });

  it("wraps fragments and keeps existing meta tags", () => {
    const fragment =
      '<meta charset="utf-8"><meta name="viewport" content="width=device-width"><p>hi</p>';
    const injected = injectHtmlRenderBootstrap(fragment);
    expect(injected.startsWith("<!doctype html><head>")).toBe(true);
    expect(injected.match(/charset/g)).toHaveLength(1);
    expect(injected.match(/name="viewport"/g)).toHaveLength(1);
    expect(injected.endsWith("<p>hi</p>")).toBe(true);
  });

  it("ignores head tags written inside scripts and comments", () => {
    const html =
      "<!-- <head> --><html><head><script>const tag = '<head>';</script></head><body>x</body></html>";
    const injected = injectHtmlRenderBootstrap(html);
    expect(injected.indexOf('<style id="e6-theme">')).toBeGreaterThan(
      injected.indexOf("<html><head>"),
    );
  });
});

describe("findHtmlRenderViewportHeightUnit", () => {
  it("finds vh in style elements and attributes only", () => {
    expect(findHtmlRenderViewportHeightUnit("<style>main{height:50svh}</style>")).toBe("50svh");
    expect(findHtmlRenderViewportHeightUnit('<div style="min-height: 10vh"></div>')).toBe("10vh");
    expect(findHtmlRenderViewportHeightUnit("<p>Use 100vh carefully</p>")).toBeUndefined();
    expect(findHtmlRenderViewportHeightUnit("<style>.a{width:10vw}</style>")).toBeUndefined();
  });
});

describe("readHtmlRenderReference", () => {
  it("accepts html attachment ids and clamps the height", () => {
    expect(readHtmlRenderReference({ ...reference, height: 1 })).toEqual({
      ...reference,
      height: 80,
    });
  });

  it("rejects ids that are not html attachments or could traverse paths", () => {
    expect(
      readHtmlRenderReference({ ...reference, attachmentId: "thread-abc-123-png" }),
    ).toBeUndefined();
    expect(readHtmlRenderReference({ ...reference, attachmentId: "../x-html" })).toBeUndefined();
    expect(readHtmlRenderReference({ ...reference, height: Number.NaN })).toBeUndefined();
  });
});

describe("htmlRenderFrameHeight", () => {
  it("uses the live content height when known, within limits", () => {
    expect(htmlRenderFrameHeight(reference)).toBe(420);
    expect(htmlRenderFrameHeight(reference, 612.2)).toBe(613);
    expect(htmlRenderFrameHeight(reference, 10)).toBe(80);
    expect(htmlRenderFrameHeight(reference, 50_000)).toBe(20_000);
  });
});

describe("frame messages", () => {
  it("reads size and http(s) link requests only", () => {
    const size = {
      jsonrpc: "2.0",
      method: "ui/notifications/size-changed",
      params: { height: 300 },
    };
    expect(readHtmlRenderContentHeight(size)).toBe(300);
    expect(readHtmlRenderContentHeight({ ...size, params: { height: -1 } })).toBeUndefined();
    const link = { jsonrpc: "2.0", method: "ui/open-link", params: { url: "https://e6.dev" } };
    expect(readHtmlRenderLinkRequest(link)).toEqual({ url: "https://e6.dev" });
    expect(
      readHtmlRenderLinkRequest({ ...link, params: { url: "javascript:alert(1)" } }),
    ).toBeUndefined();
  });
});

describe("htmlRendersByTurnId", () => {
  it("groups valid references by turn, once each, skipping turnless and malformed ones", () => {
    const other = { ...reference, attachmentId: "thread-abc-456-html" };
    const byTurn = htmlRendersByTurnId([
      { turnId: "t1", payload: { htmlRender: reference } },
      { turnId: "t1", payload: { htmlRender: reference } },
      { turnId: "t1", payload: { htmlRender: other } },
      { turnId: "t2", payload: { htmlRender: { ...reference, attachmentId: "x.png" } } },
      { turnId: null, payload: { htmlRender: reference } },
      { turnId: "t3", payload: null },
    ]);
    expect([...byTurn.entries()]).toEqual([["t1", [reference, other]]]);
  });
});
