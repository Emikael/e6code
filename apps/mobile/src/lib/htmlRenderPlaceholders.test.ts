import { TurnId } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { htmlRenderPlaceholderMessages } from "./htmlRenderPlaceholders";

const page = { attachmentId: "thread-1-aaaa-html", title: "Chart", height: 300 };
const t1 = TurnId.make("turn-1");
const t2 = TurnId.make("turn-2");

describe("htmlRenderPlaceholderMessages", () => {
  it("adds one placeholder per reply-less turn that published a page, at its last page", () => {
    const placeholders = htmlRenderPlaceholderMessages(
      [{ role: "assistant", turnId: t2 }],
      [
        { turnId: t1, createdAt: "2026-01-01T00:00:01Z", payload: { htmlRender: page } },
        { turnId: t1, createdAt: "2026-01-01T00:00:05Z", payload: { htmlRender: page } },
        { turnId: t2, createdAt: "2026-01-01T00:00:09Z", payload: { htmlRender: page } },
        { turnId: null, createdAt: "2026-01-01T00:00:10Z", payload: { htmlRender: page } },
        { turnId: t1, createdAt: "2026-01-01T00:00:11Z", payload: { other: true } },
      ],
    );
    expect(placeholders).toMatchObject([
      { role: "assistant", text: "", turnId: t1, createdAt: "2026-01-01T00:00:05Z" },
    ]);
  });
});
