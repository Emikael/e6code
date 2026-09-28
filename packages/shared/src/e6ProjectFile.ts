import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { E6ProjectFile, E6_PROJECT_FILE_SCHEMA_URL } from "@e6tools/contracts";

import { fromLenientJson } from "./schemaJson.ts";

/**
 * Codec between the raw `e6.json` file contents (lenient JSONC string) and the
 * decoded {@link E6ProjectFile}.
 */
export const E6ProjectFileFromJson = fromLenientJson(E6ProjectFile);

const decodeE6ProjectFile = Schema.decodeExit(E6ProjectFileFromJson);

/**
 * Decode raw `e6.json` contents, treating invalid or malformed files as
 * absent. Clients use this to read optional defaults (scripts, thread env
 * mode) without surfacing decode errors to the user.
 */
export function parseE6ProjectFile(contents: string): E6ProjectFile | null {
  const decoded = decodeE6ProjectFile(contents);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

/**
 * Build the publishable JSON Schema document for `e6.json` (draft 2020-12).
 *
 * Served from the marketing site at {@link E6_PROJECT_FILE_SCHEMA_URL} so
 * editors get LSP support via a `$schema` reference.
 */
export function buildE6ProjectFileJsonSchema(): Record<string, unknown> {
  // Closed objects, as before effect rc.113 changed the generator default;
  // editors then flag unknown keys in e6.json.
  const document = Schema.toJsonSchemaDocument(E6ProjectFile, { onExcessProperty: "error" });
  const jsonSchema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: E6_PROJECT_FILE_SCHEMA_URL,
    ...document.schema,
  };
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    jsonSchema.$defs = document.definitions;
  }
  return jsonSchema;
}
