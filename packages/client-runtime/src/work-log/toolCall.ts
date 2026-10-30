// Tool call bodies: the call in the foreground, its result muted below it.
const MAX_TEXT_BLOCK_DEPTH = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Wire projection replaces a large dynamic input with `{ summary, truncated: true }`. */
function isSummarizedValue(value: unknown): boolean {
  return isRecord(value) && value.truncated === true && typeof value.summary === "string";
}

function textFromBlocks(value: unknown, depth: number): string | null {
  if (depth > MAX_TEXT_BLOCK_DEPTH) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map((block) => textFromBlocks(block, depth + 1));
    return parts.every((part) => part !== null) ? parts.join("\n") : null;
  }
  if (!isRecord(value)) return null;
  if (value.type === "text" && typeof value.text === "string") return value.text;
  if (value.type === "image") return "[image]";
  if (value.type === "resource_link" && typeof value.uri === "string") return value.uri;
  if (value.type === "resource" && isRecord(value.resource)) {
    const resource = value.resource;
    if (typeof resource.text === "string") return resource.text;
    if (typeof resource.uri === "string") return resource.uri;
  }
  const keys = Object.keys(value).filter((key) => key !== "isError" && key !== "is_error");
  // MCP results and provider tool results wrap their text in `content`.
  // `structuredContent` usually repeats it as data, so it only shows when the
  // text is empty.
  if (keys.length === 1 && keys[0] === "content") return textFromBlocks(value.content, depth + 1);
  if (keys.length === 2 && keys.includes("content") && keys.includes("structuredContent")) {
    const text = textFromBlocks(value.content, depth + 1);
    return text?.trim() ? text : null;
  }
  return null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** MCP tools often return JSON as minified text, one document per line. Indent each. */
function prettyJsonText(text: string): string {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return text;
  const whole = parseJson(trimmed);
  if (whole !== undefined) return JSON.stringify(whole, null, 2);
  const lines = trimmed.split("\n").filter((line) => line.trim());
  const documents = lines.map((line) => parseJson(line.trim()));
  if (documents.some((document) => document === undefined)) return text;
  return documents.map((document) => JSON.stringify(document, null, 2)).join("\n\n");
}

/** Formats a tool input or output for display: text blocks as text, the rest as JSON. */
export function formatToolValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = textFromBlocks(value, 0);
  if (text !== null) return text.trim() ? prettyJsonText(text) : null;
  let json: string | undefined;
  try {
    json = JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
  if (json === undefined || json === "{}" || json === "[]") return null;
  return json;
}

/**
 * The call a tool row's body shows above its result: the full command, the
 * arguments as `key value` pairs, or formatted text when they are not flat.
 */
export function toolCallLines(input: {
  readonly command?: string | undefined;
  readonly args?: unknown;
}): {
  readonly command: string | null;
  readonly args: ReadonlyArray<readonly [string, string]> | null;
  readonly argsText: string | null;
} {
  if (input.command !== undefined) {
    // The row title truncates to its width, so the body always has the full command.
    const command = input.command.trim();
    return { command: command || null, args: null, argsText: null };
  }
  const args = input.args;
  if (isRecord(args) && !isSummarizedValue(args)) {
    const entries = Object.entries(args).flatMap(
      ([key, value]): Array<readonly [string, string]> => {
        if (value === undefined) return [];
        // An empty string or null can be the point of a call (a clear or reset), so show it.
        return [
          [
            key,
            typeof value === "string" && value !== ""
              ? value
              : (JSON.stringify(value) ?? String(value)),
          ],
        ];
      },
    );
    return { command: null, args: entries.length > 0 ? entries : null, argsText: null };
  }
  return { command: null, args: null, argsText: formatToolValue(args) };
}

/** An MCP tool row's call arguments and result, from the provider item stored on the entry. */
export function mcpToolCallParts(toolData: unknown): {
  readonly args: unknown;
  readonly result: string | null;
} {
  if (!isRecord(toolData)) return { args: toolData, result: null };
  const args = toolData.arguments ?? toolData.input;
  const result = formatToolValue(toolData.result ?? toolData.output ?? toolData.error);
  // Items without a recognizable call shape show as a whole, as before. So does a call with no
  // arguments and no result yet, which would otherwise expand to an empty body.
  const argsEmpty =
    args === undefined ||
    (isRecord(args) && Object.values(args).every((value) => value === undefined));
  return argsEmpty && result === null ? { args: toolData, result: null } : { args, result };
}

/** The call as plain text lines, for surfaces that render one text block. */
export function toolCallText(lines: ReturnType<typeof toolCallLines>): string | null {
  const text = [
    lines.command,
    ...(lines.args ?? []).map(([key, value]) => `${key} ${value}`),
    lines.argsText,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  return text || null;
}
