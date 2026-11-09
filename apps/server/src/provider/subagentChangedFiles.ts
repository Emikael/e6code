/**
 * Files a completed file-change item touched, with line counts where the
 * provider's own payload yields them. Adapters attach the result to the
 * item.completed row as `changedFiles`, so clients can list each subagent's
 * files and show a step's diff stat without the patches crossing the wire.
 * Clients that mean subagent files only filter on the row's `agentId`.
 */
import type { ItemChangedFile } from "@e6tools/contracts";
import { diffLines } from "diff";

/** Keeps one pathological patch from bloating every snapshot that carries it. */
const CHANGED_FILES_CAP = 64;

interface LineCounts {
  readonly additions: number;
  readonly deletions: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asPath(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Lines in a text body; a trailing newline does not open another line. */
function countTextLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = 1;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    if (index < text.length - 1) lines += 1;
  }
  return lines;
}

/** Lines a unified diff adds and removes. File headers before the first hunk are not lines. */
function countUnifiedDiffLines(diff: string): LineCounts {
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk && (line.startsWith("+++") || line.startsWith("---"))) continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

function withCounts(path: string, counts: LineCounts | undefined): ItemChangedFile {
  return counts ? { path, additions: counts.additions, deletions: counts.deletions } : { path };
}

/**
 * Codex `fileChange` item changes. An add or delete carries the file's whole
 * content as its `diff`; an update carries a unified diff.
 */
export function codexChangedFiles(changes: unknown): ReadonlyArray<ItemChangedFile> | undefined {
  if (!Array.isArray(changes)) return undefined;
  const files: ItemChangedFile[] = [];
  for (const entry of changes) {
    if (files.length >= CHANGED_FILES_CAP) break;
    const change = asRecord(entry);
    const path = asPath(change?.path);
    if (!change || !path) continue;
    const diff = typeof change.diff === "string" ? change.diff : undefined;
    const kind = asRecord(change.kind)?.type;
    // A rename lands at move_path; that is the file the diff shows.
    const movePath = kind === "update" ? asPath(asRecord(change.kind)?.move_path) : undefined;
    const counts =
      diff === undefined
        ? undefined
        : kind === "add"
          ? { additions: countTextLines(diff), deletions: 0 }
          : kind === "delete"
            ? { additions: 0, deletions: countTextLines(diff) }
            : kind === "update"
              ? countUnifiedDiffLines(diff)
              : undefined;
    files.push(withCounts(movePath ?? path, counts));
  }
  return files.length > 0 ? files : undefined;
}

/** Counts from Claude's `structuredPatch` hunks (`lines` prefixed with +, -, or space). */
function structuredPatchCounts(value: unknown): LineCounts | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  let additions = 0;
  let deletions = 0;
  for (const hunk of value) {
    const lines = asRecord(hunk)?.lines;
    if (!Array.isArray(lines)) return undefined;
    for (const line of lines) {
      if (typeof line !== "string") continue;
      if (line.startsWith("+")) additions += 1;
      else if (line.startsWith("-")) deletions += 1;
    }
  }
  return { additions, deletions };
}

/**
 * Bounds on line-diffing a pair of texts during ingestion, which runs on the
 * event loop. ACP diffs carry whole files, and jsdiff is O(N·D): a big rewrite
 * would stall every session. Past these bounds the file is listed without
 * counts rather than guessed at.
 */
const DIFF_MAX_TEXT_LENGTH = 512 * 1024;
const DIFF_MAX_EDIT_LENGTH = 2_000;
const DIFF_TIMEOUT_MS = 50;

function stringPairCounts(oldString: unknown, newString: unknown): LineCounts | undefined {
  if (typeof oldString !== "string" || typeof newString !== "string") return undefined;
  if (oldString.length + newString.length > DIFF_MAX_TEXT_LENGTH) return undefined;
  const parts = diffLines(oldString, newString, {
    maxEditLength: DIFF_MAX_EDIT_LENGTH,
    timeout: DIFF_TIMEOUT_MS,
  });
  if (parts === undefined) return undefined;
  let additions = 0;
  let deletions = 0;
  for (const part of parts) {
    if (part.added) additions += part.count;
    else if (part.removed) deletions += part.count;
  }
  return { additions, deletions };
}

/** Edit and MultiEdit counts from the tool input. replace_all hits an unknown number of sites. */
function claudeEditInputCounts(input: Record<string, unknown>): LineCounts | undefined {
  const edits = Array.isArray(input.edits) ? input.edits : [input];
  let additions = 0;
  let deletions = 0;
  for (const entry of edits) {
    const edit = asRecord(entry);
    if (!edit || edit.replace_all === true) return undefined;
    const counts = stringPairCounts(edit.old_string, edit.new_string);
    if (!counts) return undefined;
    additions += counts.additions;
    deletions += counts.deletions;
  }
  return { additions, deletions };
}

/**
 * Claude's file tools (Edit, MultiEdit, Write, NotebookEdit). The SDK's
 * tool_use_result patch is exact when present; otherwise an edit is diffed
 * from its input, and a Write counts only when it created the file.
 */
export function claudeChangedFiles(
  toolName: string,
  input: Record<string, unknown>,
  toolUseResult: Record<string, unknown> | undefined,
): ReadonlyArray<ItemChangedFile> | undefined {
  const tool = toolName.toLowerCase();
  const path = asPath(input.file_path) ?? asPath(input.notebook_path) ?? asPath(input.path);
  if (!path) return undefined;
  const patchCounts = structuredPatchCounts(toolUseResult?.structuredPatch);
  let counts: LineCounts | undefined;
  if (tool === "edit" || tool === "multiedit") {
    counts = patchCounts ?? claudeEditInputCounts(input);
  } else if (tool === "write") {
    counts =
      patchCounts ??
      (toolUseResult?.type === "create" && typeof input.content === "string"
        ? { additions: countTextLines(input.content), deletions: 0 }
        : undefined);
  } else if (tool !== "notebookedit") {
    return undefined;
  }
  return [withCounts(path, counts)];
}

/**
 * OpenCode's file tools, from the tool input. An edit is diffed from its
 * strings (replaceAll hits an unknown number of sites); a write or patch lists
 * its file without counts, since the input cannot say what was there before.
 */
export function openCodeChangedFiles(
  toolName: string,
  input: Record<string, unknown> | undefined,
): ReadonlyArray<ItemChangedFile> | undefined {
  // The SDK types tool input as an open record, so the edit tool's own
  // camelCase names come first, with the snake_case spelling as a fallback.
  // An unrecognised shape only loses the counts, never the file.
  const path = asPath(input?.filePath) ?? asPath(input?.file_path) ?? asPath(input?.path);
  if (!input || !path) return undefined;
  const replaceAll = input.replaceAll === true || input.replace_all === true;
  const counts =
    toolName.toLowerCase() === "edit" && !replaceAll
      ? stringPairCounts(input.oldString ?? input.old_string, input.newString ?? input.new_string)
      : undefined;
  return [withCounts(path, counts)];
}

/**
 * ACP `diff` tool-call content (Cursor, Grok, Antigravity). A missing
 * `oldText` means the file was created, so every line is an addition.
 */
export function acpChangedFiles(content: unknown): ReadonlyArray<ItemChangedFile> | undefined {
  if (!Array.isArray(content)) return undefined;
  const files: ItemChangedFile[] = [];
  for (const entry of content) {
    if (files.length >= CHANGED_FILES_CAP) break;
    const diff = asRecord(entry);
    const path = asPath(diff?.path);
    if (!diff || diff.type !== "diff" || !path || typeof diff.newText !== "string") continue;
    const counts =
      diff.oldText === undefined || diff.oldText === null
        ? { additions: countTextLines(diff.newText), deletions: 0 }
        : stringPairCounts(diff.oldText, diff.newText);
    files.push(withCounts(path, counts));
  }
  return files.length > 0 ? files : undefined;
}
