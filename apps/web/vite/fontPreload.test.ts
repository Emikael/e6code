// @effect-diagnostics nodeBuiltinImport:off - builds a real fixture on disk.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { build } from "vite-plus";
import { describe, expect, it } from "vite-plus/test";

import { fontPreloadPlugin } from "./fontPreload";

describe("fontPreloadPlugin", () => {
  it("preloads only the bundled Geist latin face, same-origin and with crossorigin", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "e6-font-preload-"));
    try {
      await NodeFSP.writeFile(
        NodePath.join(root, "index.html"),
        '<html><head></head><body><script type="module" src="/main.ts"></script></body></html>',
      );
      await NodeFSP.writeFile(NodePath.join(root, "main.ts"), 'import "./style.css";');
      // Larger than Vite's inline limit, so they ship as files like the real faces.
      for (const [seed, name] of [
        "geist-latin-wght-normal",
        "geist-latin-ext-wght-normal",
      ].entries()) {
        const face = new Uint8Array(8192).map((_, i) => i + seed);
        await NodeFSP.writeFile(NodePath.join(root, `${name}.woff2`), face);
      }
      await NodeFSP.writeFile(
        NodePath.join(root, "style.css"),
        '@font-face { font-family: "Geist Variable"; src: url(./geist-latin-wght-normal.woff2); }\n' +
          '@font-face { font-family: "Geist Variable"; src: url(./geist-latin-ext-wght-normal.woff2); unicode-range: U+0100; }\n',
      );

      const output = await build({
        configFile: false,
        root,
        logLevel: "silent",
        plugins: [fontPreloadPlugin()],
        build: { write: false, minify: false },
      });
      if (!("output" in output)) throw new Error("Expected one in-memory build output");
      const assets = output.output.filter((file) => file.type === "asset");
      const html = String(assets.find((file) => file.fileName === "index.html")?.source);

      const preloads = html.match(/<link rel="preload"[^>]*>/g) ?? [];
      expect(preloads).toHaveLength(1);
      expect(preloads[0]).toMatch(
        /^<link rel="preload" as="font" type="font\/woff2" crossorigin href="\/assets\/geist-latin-wght-normal-[\w-]+\.woff2">$/,
      );
      expect(html.indexOf(preloads[0]!)).toBeLessThan(html.indexOf("<script"));
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
