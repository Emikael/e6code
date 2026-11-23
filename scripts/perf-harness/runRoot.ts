// @effect-diagnostics nodeBuiltinImport:off - builds a throwaway run root on disk before any Effect runtime exists.
/**
 * The web performance harness's isolation: a throwaway run root outside the
 * repository with the seeded template home, one home copy per scenario, a
 * throwaway git workspace and a fake `HOME`, plus the guards that keep every
 * home away from the live E6 home and the one scrubbed environment every child
 * process (seed, auth CLI, server) gets.
 *
 * @module perf-harness/runRoot
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

export const REPO_ROOT = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../..",
);

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

/** Built-in provider kinds as the legacy `settings.providers` block names them. */
const BUILT_IN_PROVIDER_KINDS = [
  "codex",
  "claudeAgent",
  "cursor",
  "grok",
  "opencode",
  "antigravity",
] as const;

/** Whether `child` is `parent` or below it; both must already be resolved. */
export function isSameOrInside(parent: string, child: string): boolean {
  const relative = NodePath.relative(parent, child);
  return (
    relative === "" || (relative.split(NodePath.sep)[0] !== ".." && !NodePath.isAbsolute(relative))
  );
}

/** Live E6 homes no harness home may touch: `~/.e6` per account home, and `E6CODE_HOME`. */
export function liveHomeCandidates(input: {
  readonly accountHomes: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string | undefined>>;
}): Array<string> {
  const homes = new Set(input.accountHomes.map((home) => NodePath.join(home, ".e6")));
  const configured = input.env.E6CODE_HOME?.trim();
  if (configured) homes.add(configured);
  return [...homes];
}

/** The live home `home` collides with (equal, inside, or containing it), or `null`. */
export function findUnsafeHome(input: {
  readonly home: string;
  readonly liveHomes: ReadonlyArray<string>;
}): string | null {
  for (const live of input.liveHomes) {
    if (isSameOrInside(live, input.home) || isSameOrInside(input.home, live)) return live;
  }
  return null;
}

/**
 * `--out` must not be a live E6 home or lie inside one, and must be outside
 * the repository or a git-ignored directory inside it. All paths must already
 * be resolved. The harness never removes `--out`, so a directory that merely
 * contains a live home is allowed.
 */
export function checkOutDir(input: {
  readonly outDir: string;
  readonly repoRoot: string;
  readonly ignoredByGit: boolean;
  readonly liveHomes: ReadonlyArray<string>;
}): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const live = input.liveHomes.find((home) => isSameOrInside(home, input.outDir));
  if (live !== undefined) {
    return { ok: false, reason: `'${input.outDir}' is inside the live E6 home '${live}'` };
  }
  if (!isSameOrInside(input.repoRoot, input.outDir)) return { ok: true };
  if (input.outDir !== input.repoRoot && input.ignoredByGit) return { ok: true };
  return {
    ok: false,
    reason: `'${input.outDir}' is inside the repository and not ignored by git; reports are artifacts, not commits`,
  };
}

/**
 * Parent variables a child may inherit, compared upper-cased because Windows
 * spells some of them `Path` or `SystemRoot`. Everything else, credentials
 * (`*_TOKEN`, `*_API_KEY`, `SSH_AUTH_SOCK`), `NODE_OPTIONS` and every
 * `E6CODE_`, `VITE_` and `GIT_` variable included, stays with the parent.
 */
const INHERITED_VARIABLES = new Set([
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "TZ",
  "USER",
  "LOGNAME",
  "TERM",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
]);

const isInherited = (key: string) => {
  const upper = key.toUpperCase();
  return INHERITED_VARIABLES.has(upper) || upper.startsWith("LC_");
};

/**
 * The one environment every child process gets: only the allowlisted parent
 * variables (`INHERITED_VARIABLES`, `LC_*`), then the file secret store (the
 * OS keychain is shared machine-wide across E6 homes), a fake `HOME` and
 * `SHELL`, and unsigned git commits. `extra` adds the scenario's own `E6CODE_`
 * switches; it may not add `VITE_` variables or undo the file store.
 */
export function scrubChildEnv(
  parent: Readonly<Record<string, string | undefined>>,
  input: {
    readonly fakeHome: string;
    readonly shell: string;
    /** Directory put first on `PATH`, for the machine-name probes. */
    readonly pathPrefix?: string;
    readonly extra?: Readonly<Record<string, string>>;
  },
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (value !== undefined && isInherited(key)) env[key] = value;
  }
  for (const key of Object.keys(input.extra ?? {})) {
    if (key.startsWith("VITE_") || key === "E6CODE_SECRET_STORE") {
      throw new Error(`the perf harness never passes ${key} to a child process`);
    }
  }
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  return {
    ...env,
    ...input.extra,
    ...(input.pathPrefix === undefined
      ? {}
      : {
          [pathKey]: [input.pathPrefix, env[pathKey]].filter(Boolean).join(NodePath.delimiter),
        }),
    E6CODE_SECRET_STORE: "file",
    HOME: input.fakeHome,
    XDG_CONFIG_HOME: NodePath.join(input.fakeHome, ".config"),
    SHELL: input.shell,
    NO_COLOR: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "commit.gpgsign",
    GIT_CONFIG_VALUE_0: "false",
    GIT_CONFIG_KEY_1: "tag.gpgsign",
    GIT_CONFIG_VALUE_1: "false",
  };
}

/**
 * `userdata/settings.json` for every scenario's home: only the replayed kinds
 * are enabled, so no real provider driver boots or probes a CLI, and model
 * selections point at the default replayed instance.
 */
export function buildServerSettings(input: {
  readonly replayedKinds: ReadonlyArray<string>;
  readonly defaultModel: { readonly instanceId: string; readonly model: string };
}): Record<string, unknown> {
  return {
    enableProviderUpdateChecks: false,
    automaticGitFetchInterval: 0,
    providers: Object.fromEntries(
      BUILT_IN_PROVIDER_KINDS.map((kind) => [
        kind,
        { enabled: input.replayedKinds.includes(kind) },
      ]),
    ),
    defaultModelSelection: input.defaultModel,
    textGenerationModelSelection: input.defaultModel,
  };
}

/** The real path of `target`, resolved through its nearest existing ancestor. */
export function realPathThroughAncestors(target: string): string {
  let existing = NodePath.resolve(target);
  const missing: Array<string> = [];
  while (!NodeFS.existsSync(existing)) {
    const parent = NodePath.dirname(existing);
    if (parent === existing) break;
    missing.unshift(NodePath.basename(existing));
    existing = parent;
  }
  return NodePath.join(NodeFS.realpathSync(existing), ...missing);
}

/** Real paths of the live homes for this account and the parent environment. */
export function resolvedLiveHomes(): Array<string> {
  return liveHomeCandidates({
    accountHomes: [NodeOS.homedir(), NodeOS.userInfo().homedir],
    env: process.env,
  }).map(realPathThroughAncestors);
}

export interface RunRoot {
  readonly root: string;
  readonly templateHome: string;
  readonly workspace: string;
  readonly fakeHome: string;
  readonly shell: string;
  readonly logsDir: string;
  readonly liveHomes: ReadonlyArray<string>;
  /** The scrubbed environment, plus `extra`. */
  readonly childEnv: (extra?: Readonly<Record<string, string>>) => Record<string, string>;
}

/** Fails loudly unless `home` resolves outside every live home and outside the repository. */
function assertHarnessHome(home: string, liveHomes: ReadonlyArray<string>): string {
  const resolved = realPathThroughAncestors(home);
  const live = findUnsafeHome({ home: resolved, liveHomes });
  if (live !== null) {
    throw new Error(`refusing to use '${resolved}': it collides with the live E6 home '${live}'`);
  }
  if (isSameOrInside(realPathThroughAncestors(REPO_ROOT), resolved)) {
    throw new Error(`refusing to use '${resolved}': harness state never lives in the repository`);
  }
  return resolved;
}

const GITCONFIG = `[user]
\tname = E6 Perf Harness
\temail = perf-harness@e6.invalid
[commit]
\tgpgsign = false
[tag]
\tgpgsign = false
[init]
\tdefaultBranch = main
`;

const MACHINE_LABEL = "Perf Harness";

// Stand-ins for the machine-name lookups, so pages and screenshots never show the host's name.
const MACHINE_NAME_PROBE = `#!/bin/sh
if [ "$1" = "--get" ] && [ "$2" = "ComputerName" ]; then
  printf '%s\\n' '${MACHINE_LABEL}'
  exit 0
fi
if [ "$1" = "--pretty" ]; then
  printf '%s\\n' '${MACHINE_LABEL}'
  exit 0
fi
exit 1
`;

// Answers the server's login-shell probe without reading any profile.
const FAKE_SHELL = `#!/bin/sh
if [ "$1" = "-ilc" ] || [ "$1" = "-lic" ]; then
  exec /bin/sh -c "$2"
fi
exec /bin/cat
`;

/** Creates the run root under the system temp directory. */
export async function createRunRoot(): Promise<RunRoot> {
  const liveHomes = resolvedLiveHomes();
  const root = assertHarnessHome(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "e6-perf-")),
    liveHomes,
  );
  const templateHome = NodePath.join(root, "template-home");
  const workspace = NodePath.join(root, "workspace");
  const fakeHome = NodePath.join(root, "fake-home");
  const binDir = NodePath.join(root, "bin");
  const probeDir = NodePath.join(root, "probe-bin");
  const logsDir = NodePath.join(root, "logs");
  for (const dir of [
    workspace,
    fakeHome,
    NodePath.join(fakeHome, ".config"),
    binDir,
    probeDir,
    logsDir,
  ]) {
    await NodeFSP.mkdir(dir, { recursive: true });
  }
  await NodeFSP.writeFile(NodePath.join(fakeHome, ".gitconfig"), GITCONFIG);
  const shell = NodePath.join(binDir, "sh");
  await NodeFSP.writeFile(shell, FAKE_SHELL, { mode: 0o755 });
  for (const probe of ["scutil", "hostnamectl"]) {
    await NodeFSP.writeFile(NodePath.join(probeDir, probe), MACHINE_NAME_PROBE, { mode: 0o755 });
  }
  const childEnv = (extra?: Readonly<Record<string, string>>) =>
    scrubChildEnv(process.env, {
      fakeHome,
      shell,
      pathPrefix: probeDir,
      ...(extra ? { extra } : {}),
    });

  const git = (...args: Array<string>) =>
    execFile("git", args, { cwd: workspace, env: childEnv() });
  await git("init", "--quiet", "--initial-branch=main");
  await NodeFSP.writeFile(
    NodePath.join(workspace, "README.md"),
    "# Perf workspace\n\nThrowaway repository for the web performance harness.\n",
  );
  await git("add", "README.md");
  await git("commit", "--quiet", "--message", "Perf workspace");

  return {
    root,
    templateHome: assertHarnessHome(templateHome, liveHomes),
    workspace,
    fakeHome,
    shell,
    logsDir,
    liveHomes,
    childEnv,
  };
}

/** A fresh copy of the template home for one scenario; nothing has the template open. */
export async function scenarioHome(runRoot: RunRoot, scenario: string): Promise<string> {
  const home = assertHarnessHome(NodePath.join(runRoot.root, "homes", scenario), runRoot.liveHomes);
  await NodeFSP.cp(runRoot.templateHome, home, { recursive: true, errorOnExist: true });
  return home;
}

/** Whether git ignores `path` in the repository. */
export async function isIgnoredByGit(path: string): Promise<boolean> {
  try {
    await execFile("git", ["check-ignore", "--quiet", path], { cwd: REPO_ROOT });
    return true;
  } catch {
    return false;
  }
}
