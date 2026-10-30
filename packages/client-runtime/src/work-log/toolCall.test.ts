import { describe, expect, it } from "vite-plus/test";

import { mcpToolCallParts, toolCallLines, toolCallText } from "./toolCall.ts";

describe("toolCallLines", () => {
  it("keeps the full command", () => {
    expect(toolCallLines({ command: "  bun run test --watch  " })).toEqual({
      command: "bun run test --watch",
      args: null,
      argsText: null,
    });
  });

  it("lists flat arguments as key value pairs, keeping empty values", () => {
    expect(toolCallLines({ args: { path: "src/app.ts", limit: 20, query: "", skip: undefined } }))
      .toMatchInlineSnapshot(`
      {
        "args": [
          [
            "path",
            "src/app.ts",
          ],
          [
            "limit",
            "20",
          ],
          [
            "query",
            """",
          ],
        ],
        "argsText": null,
        "command": null,
      }
    `);
  });

  it("formats arguments that are not a flat record", () => {
    expect(toolCallLines({ args: [1, 2] })).toEqual({
      command: null,
      args: null,
      argsText: "[\n  1,\n  2\n]",
    });
  });
});

describe("mcpToolCallParts", () => {
  it("separates the arguments from the text result", () => {
    const parts = mcpToolCallParts({
      server: "e6-code",
      tool: "preview_snapshot",
      arguments: { url: "http://localhost:5173" },
      result: { content: [{ type: "text", text: "Snapshot saved" }] },
    });
    expect(parts.result).toBe("Snapshot saved");
    expect(toolCallText(toolCallLines({ args: parts.args }))).toBe("url http://localhost:5173");
  });

  it("shows a call with empty arguments and no result as a whole", () => {
    const toolData = { server: "e6-code", tool: "task_status", arguments: {} };
    expect(mcpToolCallParts(toolData)).toEqual({ args: toolData, result: null });
  });

  it("keeps empty arguments apart once the call has a result", () => {
    const parts = mcpToolCallParts({ tool: "list", arguments: {}, result: "3 items" });
    expect(parts).toEqual({ args: {}, result: "3 items" });
  });

  it("shows items without arguments as a whole", () => {
    const toolData = { server: "e6-code", tool: "task_status" };
    expect(mcpToolCallParts(toolData)).toEqual({ args: toolData, result: null });
  });
});
