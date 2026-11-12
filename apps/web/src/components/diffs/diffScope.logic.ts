/**
 * The folder whose changes the Diff shows: the thread's worktree, else its project's root, else
 * none. Never any other checkout, such as the server's own directory: when the request for this
 * folder fails, the panel shows the error card instead of another repository's changes.
 */
export function threadDiffCwd(input: {
  readonly worktreePath: string | null | undefined;
  readonly workspaceRoot: string | null | undefined;
}): string | null {
  return input.worktreePath || input.workspaceRoot || null;
}

/**
 * The error card's reason for a failed diff. The server refuses folders outside the ones it was
 * started in and its worktrees, and says so in developer terms; the card says it in the user's.
 */
export function diffErrorReason(error: string): string {
  return error.includes("configured workspace root")
    ? "This server only reads diffs inside the folder it was started in and its worktrees"
    : error;
}
