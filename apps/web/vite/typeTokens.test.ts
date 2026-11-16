// @effect-diagnostics nodeBuiltinImport:off - reads the stylesheet and sources from disk.
import * as NodeFSP from "node:fs/promises";

import { TYPE_BLOCKS } from "@e6tools/design-tokens/type";
import { describe, expect, it } from "vite-plus/test";

import { renderIndexCss } from "./designTokens";

const read = (path: string) => NodeFSP.readFile(new URL(path, import.meta.url), "utf8");
const declaredIn = (css: string) =>
  new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]!));

describe("type tokens", () => {
  // A name equal to a legacy or Tailwind one would resize legacy text.
  it("declares no name that legacy CSS, Tailwind or runtime code already declares", async () => {
    const raw = await read("../src/index.css");
    const legacy = declaredIn(renderIndexCss(raw.replace("/* @design-tokens type */", "")));
    for (const name of declaredIn(await read("../node_modules/tailwindcss/theme.css"))) {
      legacy.add(name);
    }
    expect(legacy.has("--text-xs")).toBe(true);

    const typeNames = TYPE_BLOCKS.type.body.flatMap((node) =>
      Array.isArray(node) ? [node[0] as string] : [],
    );
    expect(typeNames.filter((name) => legacy.has(name))).toEqual([]);
  });
});
