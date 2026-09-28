export type ComposerInlineToken =
  | {
      readonly type: "mention";
      readonly value: string;
      readonly source: string;
      readonly start: number;
      readonly end: number;
    }
  | {
      readonly type: "skill";
      readonly value: string;
      readonly source: string;
      readonly start: number;
      readonly end: number;
    };

export interface CollectComposerInlineTokensOptions {
  readonly preserveTrailingFrom?: ReadonlyArray<ComposerInlineToken>;
}

/**
 * A skill name may start with a digit, but compact monetary amounts and
 * numeric expressions like "$20", "$20k", "$100M", and "$1e6" must stay prose:
 * the composer chips any matched `$name` token, known or not. Tokens beginning
 * with digits must not match numbers with currency/exponent suffixes, and must
 * contain at least one letter.
 */
const SKILL_TOKEN_REGEX =
  /(^|\s)\p{Sc}(?![0-9][0-9_]*(?:[kKmMbBtT]|[eE][0-9]+)?(?:\s|$))(?=[a-zA-Z0-9:_-]*[a-zA-Z])([a-zA-Z0-9][a-zA-Z0-9:_-]*)(?=\s)/gu;
const MAX_MENTION_PATH_LENGTH = 4096;
/**
 * The label body is bounded rather than `*`. Unbounded, every whitespace in
 * the composer is a candidate start: the engine scans the rest of the text for
 * a closing `]`, fails, and rescans from the next whitespace — quadratic on
 * input like " [[[[[…". A cap makes each attempt constant-bounded.
 *
 * Only a basename ever survives the `label !== basename` check below, so this
 * cannot reject a link a user could meaningfully write; the longest filename
 * any common filesystem allows is 255.
 */
const MAX_FILE_LINK_LABEL_LENGTH = 512;
const FILE_LINK_TOKEN_REGEX = new RegExp(
  `(^|\\s)\\[((?:\\\\.|[^\\]\\\\]){0,${MAX_FILE_LINK_LABEL_LENGTH}})\\]\\(([^)\\s]+)\\)(?=\\s)`,
  "g",
);
const URI_SCHEME_REGEX = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WINDOWS_DRIVE_PATH_REGEX = /^[A-Za-z]:[\\/]/;

function unescapeQuoted(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 92 && index + 1 < value.length) {
      result += value[index + 1]!;
      index += 1;
    } else {
      result += value[index]!;
    }
  }
  return result;
}

function isComposerWhitespace(char: string): boolean {
  return char.trim() === "";
}

function isScopedPackageNameStart(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
}

function isScopedPackageNameContinue(code: number): boolean {
  return isScopedPackageNameStart(code) || code === 46 || code === 95 || code === 45;
}

function isForbiddenScopedSegmentChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return isComposerWhitespace(char) || code === 64 || code === 34 || code === 47;
}

/** `@scope/pkg` and `@scope/pkg/sub` stay prose; only quoted mentions chip those paths. */
function isScopedPackageReference(path: string): boolean {
  let index = 0;
  if (index >= path.length || !isScopedPackageNameStart(path.charCodeAt(index))) return false;
  index += 1;
  while (index < path.length && isScopedPackageNameContinue(path.charCodeAt(index))) index += 1;
  if (index >= path.length || path.charCodeAt(index) !== 47) return false;
  index += 1;
  if (index >= path.length || !isScopedPackageNameStart(path.charCodeAt(index))) return false;
  index += 1;
  while (index < path.length && isScopedPackageNameContinue(path.charCodeAt(index))) index += 1;
  while (index < path.length) {
    if (path.charCodeAt(index) !== 47) return false;
    index += 1;
    if (index >= path.length || isForbiddenScopedSegmentChar(path[index]!)) return false;
    index += 1;
    while (index < path.length && path.charCodeAt(index) !== 47) {
      if (isForbiddenScopedSegmentChar(path[index]!)) return false;
      index += 1;
    }
  }
  return true;
}

function collectAtMentions(text: string): ComposerInlineToken[] {
  const matches: ComposerInlineToken[] = [];
  let index = 0;
  while (index < text.length) {
    const at = text.indexOf("@", index);
    if (at < 0) break;
    if (at > 0 && !isComposerWhitespace(text[at - 1]!)) {
      index = at + 1;
      continue;
    }
    const afterAt = at + 1;
    if (afterAt >= text.length) break;

    if (text.charCodeAt(afterAt) === 34) {
      let cursor = afterAt + 1;
      let units = 0;
      let closed = -1;
      while (cursor < text.length && units < MAX_MENTION_PATH_LENGTH) {
        const code = text.charCodeAt(cursor);
        if (code === 92 && cursor + 1 < text.length) {
          cursor += 2;
          units += 1;
          continue;
        }
        if (code === 34) {
          closed = cursor;
          break;
        }
        cursor += 1;
        units += 1;
      }
      if (closed < 0) {
        index = at + 1;
        continue;
      }
      const end = closed + 1;
      if (end >= text.length || !isComposerWhitespace(text[end]!)) {
        index = at + 1;
        continue;
      }
      const path = unescapeQuoted(text.slice(afterAt + 1, closed));
      if (path) {
        matches.push({
          type: "mention",
          value: path,
          source: text.slice(at, end),
          start: at,
          end,
        });
      }
      index = end;
      continue;
    }

    let end = afterAt;
    while (
      end < text.length &&
      end - afterAt < MAX_MENTION_PATH_LENGTH &&
      !isComposerWhitespace(text[end]!) &&
      text.charCodeAt(end) !== 64 &&
      text.charCodeAt(end) !== 34
    ) {
      end += 1;
    }
    if (end === afterAt || end >= text.length || !isComposerWhitespace(text[end]!)) {
      index = at + 1;
      continue;
    }
    const path = text.slice(afterAt, end);
    if (!isScopedPackageReference(path)) {
      matches.push({
        type: "mention",
        value: path,
        source: text.slice(at, end),
        start: at,
        end,
      });
    }
    index = end;
  }
  return matches;
}

function collectMentionTokens(text: string): ComposerInlineToken[] {
  const matches: ComposerInlineToken[] = [];

  for (const match of text.matchAll(FILE_LINK_TOKEN_REGEX)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const label = unescapeQuoted(match[2] ?? "");
    const encodedPath = match[3] ?? "";
    let path = encodedPath;
    try {
      path = decodeURIComponent(encodedPath);
    } catch {
      // Preserve malformed source rather than dropping a user-authored token.
    }
    const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const basename = separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
    const hasExternalScheme = URI_SCHEME_REGEX.test(path) && !WINDOWS_DRIVE_PATH_REGEX.test(path);
    if (!path || hasExternalScheme || label !== basename) {
      continue;
    }
    const start = (match.index ?? 0) + prefix.length;
    const end = start + fullMatch.length - prefix.length;
    matches.push({
      type: "mention",
      value: path,
      source: text.slice(start, end),
      start,
      end,
    });
  }

  matches.push(...collectAtMentions(text));

  return matches;
}

export function collectComposerInlineTokens(
  text: string,
  options: CollectComposerInlineTokensOptions = {},
): ReadonlyArray<ComposerInlineToken> {
  const matches = collectMentionTokens(text);

  for (const match of text.matchAll(SKILL_TOKEN_REGEX)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const value = match[2] ?? "";
    if (!value) {
      continue;
    }
    const start = (match.index ?? 0) + prefix.length;
    const end = start + fullMatch.length - prefix.length;
    matches.push({
      type: "skill",
      value,
      source: text.slice(start, end),
      start,
      end,
    });
  }

  for (const token of options.preserveTrailingFrom ?? []) {
    if (
      token.end === text.length &&
      text.slice(token.start, token.end) === token.source &&
      !matches.some(
        (match) =>
          match.type === token.type && match.start === token.start && match.end === token.end,
      )
    ) {
      matches.push(token);
    }
  }

  return [...matches].sort((left, right) => left.start - right.start);
}
