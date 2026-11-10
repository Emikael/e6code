import type { ProjectId, ProjectScript, ServerSettings } from "@e6tools/contracts";

type ProjectScriptSettings = Pick<
  ServerSettings,
  | "defaultProjectScripts"
  | "projectScriptOverrides"
  | "projectSettingsOverrides"
  | "projectSettingsFolded"
>;

/**
 * The project's override wins, then environment defaults. Until the legacy
 * fields have been folded into `projectSettingsOverrides`, the old map (null
 * there meant "reset to machine defaults") and the aggregate's own scripts
 * still count, so a server that has not run the fold yet behaves as before.
 */
export function resolveProjectScripts(
  settings: ProjectScriptSettings,
  project: { id: ProjectId; scripts: readonly ProjectScript[] },
): readonly ProjectScript[] {
  const override = settings.projectSettingsOverrides[project.id]?.defaultProjectScripts;
  if (override !== undefined) return override;
  if (settings.projectSettingsFolded) return settings.defaultProjectScripts;
  const legacy = settings.projectScriptOverrides[project.id];
  if (legacy === null) return settings.defaultProjectScripts;
  return legacy ?? (project.scripts.length > 0 ? project.scripts : settings.defaultProjectScripts);
}

export function projectScriptsInheritDefaults(
  settings: ProjectScriptSettings,
  project: { id: ProjectId; scripts: readonly ProjectScript[] },
): boolean {
  if (settings.projectSettingsOverrides[project.id]?.defaultProjectScripts !== undefined) {
    return false;
  }
  if (settings.projectSettingsFolded) return true;
  const legacy = settings.projectScriptOverrides[project.id];
  return legacy === null || (legacy === undefined && project.scripts.length === 0);
}

interface ProjectScriptRuntimeEnvInput {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
  extraEnv?: Record<string, string>;
}

export function projectScriptCwd(input: {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
}): string {
  return input.worktreePath ?? input.project.cwd;
}

export function projectScriptRuntimeEnv(
  input: ProjectScriptRuntimeEnvInput,
): Record<string, string> {
  const env: Record<string, string> = {
    E6CODE_PROJECT_ROOT: input.project.cwd,
  };
  if (input.worktreePath) {
    env.E6CODE_WORKTREE_PATH = input.worktreePath;
  }
  if (input.extraEnv) {
    return { ...env, ...input.extraEnv };
  }
  return env;
}

export function setupProjectScript(scripts: readonly ProjectScript[]): ProjectScript | null {
  return scripts.find((script) => script.runOnWorktreeCreate) ?? null;
}

/**
 * Short fingerprint of a setup script's command, recorded on a thread when
 * its worktree runs the script and compared with the project's current setup
 * script to tell the user the worktree is out of date. Synchronous FNV-1a so
 * the server and every client compute the same value without async crypto.
 * It only answers "did the command change", so a 32-bit hash is plenty.
 */
export function projectScriptHash(script: Pick<ProjectScript, "command">): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < script.command.length; index += 1) {
    hash ^= script.command.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Whether the thread's worktree ran a setup script other than the project's
 * current one. False when there is nothing to compare: no worktree, no
 * recorded setup, or no setup script configured any more.
 */
export function isWorktreeSetupStale(
  thread: {
    readonly worktreePath: string | null;
    readonly setupScriptHash?: string | null | undefined;
  },
  scripts: readonly ProjectScript[],
): boolean {
  if (!thread.worktreePath || !thread.setupScriptHash) return false;
  const current = setupProjectScript(scripts);
  return current !== null && projectScriptHash(current) !== thread.setupScriptHash;
}
