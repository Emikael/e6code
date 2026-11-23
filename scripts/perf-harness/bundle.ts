// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - reads and compresses the built web client from disk.
/**
 * The built web client as the harness sees it: whether the server serves a
 * production build, whether that build is stale, and the size of the scripts
 * a cold load actually fetched, mapped back to their files in
 * `apps/web/dist/assets` and compressed with brotli at quality 11.
 *
 * @module perf-harness/bundle
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as NodeZlib from "node:zlib";

const brotliCompress = NodeUtil.promisify(NodeZlib.brotliCompress);
const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

/** The built file a served script URL names, or `null` for anything but `/assets/*.js`. */
export function distAssetPath(url: string, distDir: string): string | null {
  let relative: string;
  try {
    const { pathname } = new URL(url);
    if (!pathname.startsWith("/assets/") || !pathname.endsWith(".js")) return null;
    relative = decodeURIComponent(pathname.slice("/assets/".length));
  } catch {
    return null;
  }
  const assetsDir = NodePath.join(distDir, "assets");
  const resolved = NodePath.resolve(assetsDir, relative);
  return resolved.startsWith(`${assetsDir}${NodePath.sep}`) ? resolved : null;
}

const sizes = new Map<
  string,
  Promise<{ readonly rawBytes: number; readonly brotliBytes: number }>
>();

/** Raw and brotli-11 sizes of one file, computed once per run. */
function fileSizes(
  path: string,
): Promise<{ readonly rawBytes: number; readonly brotliBytes: number }> {
  const cached = sizes.get(path);
  if (cached !== undefined) return cached;
  const computed = NodeFSP.readFile(path).then(async (contents) => {
    const compressed = await brotliCompress(contents, {
      params: {
        [NodeZlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [NodeZlib.constants.BROTLI_PARAM_MODE]: NodeZlib.constants.BROTLI_MODE_TEXT,
        [NodeZlib.constants.BROTLI_PARAM_SIZE_HINT]: contents.length,
      },
    });
    return { rawBytes: contents.length, brotliBytes: compressed.length };
  });
  sizes.set(path, computed);
  return computed;
}

/**
 * The production-build check (§7.1): the server's `/` is the built
 * `index.html`, never the Vite dev client, and its scripts are hashed assets.
 */
export async function checkProductionBuild(
  origin: string,
  distDir: string,
): Promise<{ readonly productionBuild: boolean; readonly notes: ReadonlyArray<string> }> {
  const notes: Array<string> = [];
  const served = await fetch(`${origin}/`).then((response) => response.text());
  const built = await NodeFSP.readFile(NodePath.join(distDir, "index.html"), "utf8").catch(
    () => null,
  );
  const scripts = [...served.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]!);
  const viteClient = served.includes("/@vite/client");
  const hashed =
    scripts.length > 0 && scripts.every((src) => /^\/assets\/.+-[\w-]{6,}\.js$/.test(src));
  const fromDist = built !== null && served === built;
  if (viteClient)
    notes.push("the served index.html loads /@vite/client: a dev server, not a build");
  if (!hashed)
    notes.push(`the served scripts are not hashed /assets/ files: ${scripts.join(", ")}`);
  if (!fromDist) notes.push(`the served index.html is not ${NodePath.join(distDir, "index.html")}`);
  return { productionBuild: !viteClient && hashed && fromDist, notes };
}

/**
 * Whether `apps/web/dist` predates the web client's sources: the last commit
 * touching `apps/web` or `packages/`, or an uncommitted change there written
 * after the build.
 */
export async function isWebBuildStale(distDir: string, repoRoot: string): Promise<boolean> {
  const builtAtMs = await NodeFSP.stat(NodePath.join(distDir, "index.html")).then(
    (stat) => stat.mtimeMs,
    () => 0,
  );
  const git = (args: ReadonlyArray<string>) =>
    execFile("git", [...args], { cwd: repoRoot }).then(
      ({ stdout }) => stdout,
      () => "",
    );
  const committedAtMs =
    Number.parseInt(
      (await git(["log", "-1", "--format=%ct", "--", "apps/web", "packages"])).trim(),
      10,
    ) * 1000;
  if (Number.isFinite(committedAtMs) && committedAtMs > builtAtMs) return true;
  const changed = (await git(["status", "--porcelain", "--", "apps/web/src", "packages"]))
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter((path) => path.length > 0);
  for (const path of changed) {
    const changedAtMs = await NodeFSP.stat(NodePath.join(repoRoot, path)).then(
      (stat) => stat.mtimeMs,
      () => 0,
    );
    if (changedAtMs > builtAtMs) return true;
  }
  return false;
}

/** Sizes of the distinct built scripts among `urls`; URLs with no built file are listed apart. */
export async function observedScriptBytes(
  urls: ReadonlyArray<string>,
  distDir: string,
): Promise<{
  readonly files: ReadonlyArray<{
    readonly file: string;
    readonly rawBytes: number;
    readonly brotliBytes: number;
  }>;
  readonly brotliBytes: number;
  readonly rawBytes: number;
  readonly unmatched: ReadonlyArray<string>;
}> {
  const paths = new Set<string>();
  const unmatched: Array<string> = [];
  for (const url of urls) {
    const path = distAssetPath(url, distDir);
    if (path === null) unmatched.push(url);
    else paths.add(path);
  }
  const files = await Promise.all(
    [...paths].toSorted().map(async (path) => {
      const exists = await NodeFSP.stat(path).then(
        (stat) => stat.isFile(),
        () => false,
      );
      if (!exists) return null;
      return { file: NodePath.relative(distDir, path), ...(await fileSizes(path)) };
    }),
  );
  const present = files.filter((file) => file !== null);
  for (const path of paths) {
    if (!present.some((file) => NodePath.join(distDir, file.file) === path)) unmatched.push(path);
  }
  return {
    files: present,
    brotliBytes: present.reduce((sum, file) => sum + file.brotliBytes, 0),
    rawBytes: present.reduce((sum, file) => sum + file.rawBytes, 0),
    unmatched,
  };
}
