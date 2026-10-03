import type { APIRoute } from "astro";

import { buildE6ProjectFileJsonSchema } from "@e6tools/shared/e6ProjectFile";

// Rendered at build time and published at https://e6code.com/schema/e6.json.
// e6.json files reference that URL for editor support. Older files name
// https://e6.codes/schema/e6.json; readers still accept it.
export const GET: APIRoute = () =>
  new Response(`${JSON.stringify(buildE6ProjectFileJsonSchema(), null, 2)}\n`, {
    headers: { "Content-Type": "application/json" },
  });
