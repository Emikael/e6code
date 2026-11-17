// @effect-diagnostics nodeBuiltinImport:off - test-only corpus listing, read synchronously at test collection time.
/**
 * Where replay recordings live. `fixtures/` holds small hand-made recordings
 * that tests rely on; `recordings/` holds scrubbed recordings of real provider
 * sessions. Both are checked by the corpus test, and replay tests run every
 * file in both.
 *
 * @module testing/providerReplay/corpus
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

export type CorpusFileKind = "fixture" | "recording";

export interface CorpusFile {
  readonly kind: CorpusFileKind;
  readonly name: string;
  readonly path: string;
}

const corpusDirectories: ReadonlyArray<readonly [CorpusFileKind, string]> = [
  ["fixture", NodeURL.fileURLToPath(new URL("./fixtures/", import.meta.url))],
  ["recording", NodeURL.fileURLToPath(new URL("./recordings/", import.meta.url))],
];

/** Lists every `.ndjson` recording, fixtures first, sorted by name. */
export function listCorpusFiles(): ReadonlyArray<CorpusFile> {
  const files: Array<CorpusFile> = [];
  for (const [kind, directory] of corpusDirectories) {
    if (!NodeFS.existsSync(directory)) continue;
    for (const name of [...NodeFS.readdirSync(directory)].sort()) {
      if (!name.endsWith(".ndjson")) continue;
      files.push({ kind, name, path: NodePath.join(directory, name) });
    }
  }
  return files;
}

export function readCorpusFile(file: CorpusFile): string {
  return NodeFS.readFileSync(file.path, "utf8");
}
