export function isWindowsDrivePath(value: string): boolean {
  return /^[a-zA-Z]:([/\\]|$)/.test(value);
}

export function isUncPath(value: string): boolean {
  return value.startsWith("\\\\");
}

export function isWindowsAbsolutePath(value: string): boolean {
  return isUncPath(value) || isWindowsDrivePath(value);
}

export function isExplicitRelativePath(value: string): boolean {
  return (
    value === "." ||
    value === ".." ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith(".\\") ||
    value.startsWith("..\\")
  );
}

function isRootPath(value: string): boolean {
  // The drive separator is required: a bare `C:` is not the drive root (it
  // means "current directory on C:"), and treating it as already-canonical
  // would leave it as `C:` while `C:\` and `C:/` normalize to the drive root,
  // so the same location would fail project identity/dedup comparisons.
  return value === "/" || value === "\\" || /^[a-zA-Z]:[/\\]$/.test(value);
}

const SLASH = 47;
const BACKSLASH = 92;

/** Trim trailing `/` without a quantified regular expression. */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === SLASH) end -= 1;
  return value.slice(0, end);
}

/** Trim trailing `/` and `\` without a quantified character-class regular expression. */
export function trimTrailingSlashOrBackslash(value: string): string {
  let end = value.length;
  while (end > 0) {
    const code = value.charCodeAt(end - 1);
    if (code !== SLASH && code !== BACKSLASH) break;
    end -= 1;
  }
  return value.slice(0, end);
}

/** Trim leading `/` and `\`. */
export function trimLeadingSlashOrBackslash(value: string): string {
  let start = 0;
  while (start < value.length) {
    const code = value.charCodeAt(start);
    if (code !== SLASH && code !== BACKSLASH) break;
    start += 1;
  }
  return value.slice(start);
}

/** Rewrite `/` and `\` to `separator` without a character-class regular expression. */
export function replacePathSeparators(value: string, separator: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    result += code === SLASH || code === BACKSLASH ? separator : value[index]!;
  }
  return result;
}

function trimTrailingPathSeparators(value: string): string {
  if (value.length === 0 || isRootPath(value)) {
    return value;
  }
  const trimmed = value.startsWith("/")
    ? trimTrailingSlashes(value)
    : trimTrailingSlashOrBackslash(value);
  if (trimmed.length === 0) {
    return value;
  }
  return /^[a-zA-Z]:$/.test(trimmed) ? `${trimmed}\\` : trimmed;
}

export function normalizeProjectPathForDispatch(value: string): string {
  return trimTrailingPathSeparators(value.trim());
}

export function normalizeProjectPathForComparison(value: string): string {
  const normalized = normalizeProjectPathForDispatch(value);
  if (isWindowsDrivePath(normalized) || isUncPath(normalized)) {
    return normalized.replaceAll("/", "\\").toLowerCase();
  }
  return normalized;
}
