import { GitCommandError } from "@e6tools/contracts";

const MAX_REVISION_LENGTH = 1024;
const MAX_PATH_LENGTH = 4096;

/**
 * Rejects operands git would parse as options, including a slash component
 * such as `origin/-b`. `check-ref-format --branch` accepts that shape.
 */
export function isUnsafeGitOperand(value: string): boolean {
  if (value.length === 0 || value.length > MAX_REVISION_LENGTH) {
    return true;
  }
  if (value.includes("\0") || /[\r\n\t ]/.test(value)) {
    return true;
  }
  return value.split("/").some((part) => part.length === 0 || part.startsWith("-"));
}

/** Worktree paths may contain spaces. They still must not look like options. */
export function isUnsafeGitPath(value: string): boolean {
  if (value.length === 0 || value.length > MAX_PATH_LENGTH) {
    return true;
  }
  if (value.startsWith("-") || value.includes("\0") || /[\r\n]/.test(value)) {
    return true;
  }
  return false;
}

export function isUnsafeRefspecComponent(value: string): boolean {
  return isUnsafeGitOperand(value) || /[:^~]/.test(value);
}

export function unsafeGitRefError(input: {
  readonly operation: string;
  readonly cwd: string;
}): GitCommandError {
  return new GitCommandError({
    operation: input.operation,
    command: "git",
    cwd: input.cwd,
    detail: "Git ref was rejected because it is not a safe revision.",
  });
}
