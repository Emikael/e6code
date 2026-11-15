// @effect-diagnostics nodeBuiltinImport:off - builds a real fixture on disk.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { build } from "vite-plus";
import { describe, expect, it } from "vite-plus/test";

import { designTokensPlugin, renderIndexCss, renderIndexHtml } from "./designTokens";
import { tailwindPlugins } from "./tailwind";

const readSource = (path: string) => NodeFSP.readFile(new URL(path, import.meta.url), "utf8");
const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("design-token placeholders", () => {
  // A placeholder that goes missing would silently ship stale or no values, and one left
  // unrendered breaks the boot script, so both directions are pinned.
  it("consumes every placeholder in index.html", async () => {
    const raw = await readSource("../index.html");
    for (const name of [
      "boot-backgrounds",
      "boot-palette",
      "boot-reserved-theme-ids",
      "boot-style",
    ]) {
      expect(count(raw, `/* @design-tokens ${name} */`), name).toBe(1);
    }
    expect(count(raw, "%E6_BOOT_THEME_COLOR%")).toBe(1);

    const rendered = renderIndexHtml(raw);
    expect(rendered).not.toContain("@design-tokens");
    expect(rendered).not.toContain("%E6_BOOT_THEME_COLOR%");
  });

  it("consumes every placeholder in index.css", async () => {
    const raw = await readSource("../src/index.css");
    for (const name of ["stock-geometry", "stock-palette", "stock-sidebar"]) {
      expect(count(raw, `/* @design-tokens ${name} */`), name).toBe(1);
    }
    expect(renderIndexCss(raw)).not.toContain("@design-tokens");
  });

  it("rejects an unknown placeholder instead of leaving it in place", () => {
    expect(() => renderIndexCss("/* @design-tokens stock-unknown */")).toThrow("stock-unknown");
  });
});

describe("designTokensPlugin", () => {
  it("renders tokens before Tailwind compiles the stylesheet", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "e6-design-tokens-"));
    try {
      await NodeFSP.writeFile(
        NodePath.join(root, "index.html"),
        '<html><head><meta name="theme-color" content="%E6_BOOT_THEME_COLOR%" /></head>' +
          '<body><script type="module" src="/main.ts"></script></body></html>',
      );
      await NodeFSP.writeFile(NodePath.join(root, "main.ts"), 'import "./style.css";');
      await NodeFSP.writeFile(
        NodePath.join(root, "style.css"),
        '@import "tailwindcss" source(none);\n\n/* @design-tokens stock-palette */\n',
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
      const html = String(assets.find((file) => file.fileName === "index.html")?.source);

      expect(css).toContain("--primary: var(--stock-primary, #5b4ae0);");
      // Tailwind-only syntax in the injected block was compiled, so Tailwind saw it.
      expect(css).not.toContain("--alpha(");
      expect(css).not.toContain("@variant");
      expect(html).toContain('<meta name="theme-color" content="#0a0a0a" />');
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
