// @effect-diagnostics nodeBuiltinImport:off - reads the stylesheet and builds a fixture on disk.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { BREAKPOINTS, LAYOUT } from "@e6tools/design-tokens/layout";
import type { CssNode } from "@e6tools/design-tokens/webStock";
import { build } from "vite-plus";
import { describe, expect, it } from "vite-plus/test";

import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../src/rightPanelLayout";
import { designTokensPlugin, renderIndexCss } from "./designTokens";
import { tailwindPlugins } from "./tailwind";

const read = (path: string) => NodeFSP.readFile(new URL(path, import.meta.url), "utf8");
const declaredIn = (css: string) =>
  new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]!));

function declarations(nodes: ReadonlyArray<CssNode>): string[] {
  return nodes.flatMap((node) =>
    "rule" in node ? declarations(node.body) : "comment" in node ? [] : [node[0]],
  );
}

describe("layout tokens", () => {
  // A new name equal to a legacy one would resize legacy UI.
  it("declares no name that legacy CSS or Tailwind already declares", async () => {
    const raw = await read("../src/index.css");
    const legacy = declaredIn(renderIndexCss(raw.replace("/* @design-tokens layout */", "")));
    for (const name of declaredIn(await read("../node_modules/tailwindcss/theme.css"))) {
      legacy.add(name);
    }
    expect(legacy.has("--panel-gap")).toBe(true);
    expect(legacy.has("--chat-max-width")).toBe(true);

    expect(declarations(LAYOUT).filter((name) => legacy.has(name))).toEqual([]);
  });

  it("records the breakpoints legacy layout switches at", async () => {
    const theme = await read("../node_modules/tailwindcss/theme.css");
    const breakpoint = (name: string) =>
      Number(theme.match(new RegExp(`--breakpoint-${name}: ([\\d.]+)rem`))![1]) * 16;
    expect(BREAKPOINTS.compact).toBe(breakpoint("sm"));
    expect(BREAKPOINTS.sheet).toBe(breakpoint("md"));
    expect(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY).toBe(
      `(max-width: ${BREAKPOINTS.rightPanelSheet}px)`,
    );
  });

  it("compiles into height and measure utilities and a desktop-only panel gap", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "e6-layout-tokens-"));
    try {
      await NodeFSP.writeFile(
        NodePath.join(root, "index.html"),
        '<html><body><script type="module" src="/main.ts"></script></body></html>',
      );
      await NodeFSP.writeFile(NodePath.join(root, "main.ts"), 'import "./style.css";');
      await NodeFSP.writeFile(
        NodePath.join(root, "style.css"),
        '@import "tailwindcss" source(none);\n' +
          '@source inline("h-row h-row-dense h-control-lg min-h-touch max-w-chat");\n\n' +
          "/* @design-tokens layout */\n",
      );

      const output = await build({
        configFile: false,
        root,
        logLevel: "silent",
        resolve: {
          alias: {
            tailwindcss: NodeURL.fileURLToPath(
              new URL("../node_modules/tailwindcss/index.css", import.meta.url),
            ),
          },
        },
        plugins: [designTokensPlugin(), ...tailwindPlugins(false)],
        build: { write: false, minify: false },
      });
      if (!("output" in output)) throw new Error("Expected one in-memory build output");
      const assets = output.output.filter((file) => file.type === "asset");
      const css = String(assets.find((file) => file.fileName.endsWith(".css"))?.source);

      expect(css).toMatch(/\.h-row \{\s*height: var\(--row\);/);
      expect(css).toMatch(/\.h-row-dense \{\s*height: var\(--row-dense\);/);
      expect(css).toMatch(/\.h-control-lg \{\s*height: var\(--control-lg\);/);
      expect(css).toMatch(/\.min-h-touch \{\s*min-height: var\(--touch\);/);
      expect(css).toMatch(/\.max-w-chat \{\s*max-width: var\(--measure-chat\);/);
      expect(css).toMatch(
        /@media \((?:width >=|min-width:) 48rem\) \{\s*:root \{\s*--gap-panel: 0?\.625rem;/,
      );
      expect(css).not.toContain("@variant");
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
