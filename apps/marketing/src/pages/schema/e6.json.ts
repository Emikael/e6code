import type { APIRoute } from "astro";

import { buildE6ProjectFileJsonSchema } from "@e6tools/shared/e6ProjectFile";

// Rendered at build time; published at https://e6.codes/schema/e6.json so
// e6.json files can reference it via "$schema" for editor/LSP support.
export const GET: APIRoute = () =>
  new Response(`${JSON.stringify(buildE6ProjectFileJsonSchema(), null, 2)}\n`, {
    headers: { "Content-Type": "application/json" },
  });
