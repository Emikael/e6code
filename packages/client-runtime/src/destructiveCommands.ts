import type { ProviderRequestKind } from "@e6tools/contracts";

/**
 * Flags shell commands whose damage is hard to undo, so approval UIs can ask
 * for a deliberate hold instead of a click. The list is deliberately short: a
 * false positive trains people to hold through every prompt, so only broad,
 * well-known patterns qualify. Ordinary deletes such as `rm -rf dist` do not.
 */
export interface DestructiveCommand {
  /** Short, user-facing consequence, e.g. "Deletes files recursively". */
  readonly reason: string;
}

const PROTECTED_BRANCH =
  /^(?:main|master|trunk|develop|development|production|prod|release(?:[/-].+)?)$/i;
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
const PREFIX_COMMANDS = new Set([
  "sudo",
  "doas",
  "env",
  "command",
  "exec",
  "nohup",
  "time",
  "nice",
]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const FORK_BOMB = /:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:/;
const SQL_DROP = /\bdrop\s+(table|database|schema)\b/i;
const SQL_CLIENTS = new Set([
  "psql",
  "mysql",
  "mariadb",
  "sqlite3",
  "sqlcmd",
  "duckdb",
  "clickhouse-client",
  "cockroach",
]);

/** Classifies the command behind a pending approval, if it runs one. */
export function classifyDestructiveApproval(approval: {
  readonly requestKind: ProviderRequestKind;
  readonly detail?: string | undefined;
}): DestructiveCommand | null {
  if (approval.requestKind !== "command" && approval.requestKind !== "permission") return null;
  if (!approval.detail) return null;
  // Claude details read "Bash: <command>"; the tool name is not part of it.
  return classifyDestructiveCommand(approval.detail.replace(/^[A-Za-z][\w-]*:\s+/, ""));
}

export function classifyDestructiveCommand(command: string): DestructiveCommand | null {
  if (FORK_BOMB.test(command)) return { reason: "Starts a fork bomb that can freeze the machine" };
  for (const words of splitShellCommands(command)) {
    const found = classifyWords(stripPrefixes(words));
    if (found) return found;
  }
  return null;
}

function classifyWords(words: ReadonlyArray<string>): DestructiveCommand | null {
  const [program, ...args] = words;
  if (program === undefined) return null;
  const name = program.slice(program.lastIndexOf("/") + 1);

  if (SHELLS.has(name)) {
    const scriptIndex = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg));
    const script = scriptIndex === -1 ? undefined : args[scriptIndex + 1];
    return script === undefined ? null : classifyDestructiveCommand(script);
  }
  if (name === "rm") return classifyRm(args);
  if (name === "git") return classifyGit(args);
  if (name === "chmod") return classifyChmod(args);
  if (name === "mkfs" || name.startsWith("mkfs.")) return { reason: "Formats a disk" };
  if (name === "dd" && args.some((arg) => arg.startsWith("of=/dev/"))) {
    return { reason: "Overwrites a disk device" };
  }
  // SQL counts only when a database client runs it, or as a bare statement
  // line (a heredoc fed to one); `echo "drop table"` is not a drop.
  const drop =
    SQL_CLIENTS.has(name) || name.toLowerCase() === "drop" ? SQL_DROP.exec(words.join(" ")) : null;
  if (drop) {
    return {
      reason: drop[1]!.toLowerCase() === "table" ? "Drops a database table" : "Drops a database",
    };
  }
  return null;
}

function classifyRm(args: ReadonlyArray<string>): DestructiveCommand | null {
  const { flags, operands } = splitFlags(args);
  const recursive = flags.has("r") || flags.has("R") || flags.has("recursive");
  if (!recursive) return null;
  if (flags.has("no-preserve-root") || operands.some(isBroadPath)) {
    return { reason: "Deletes files recursively" };
  }
  return null;
}

function classifyChmod(args: ReadonlyArray<string>): DestructiveCommand | null {
  const { flags, operands } = splitFlags(args);
  if (!(flags.has("R") || flags.has("recursive"))) return null;
  const [mode, ...paths] = operands;
  if (mode !== "777" && mode !== "0777" && mode !== "a+rwx") return null;
  return paths.some(isBroadPath) ? { reason: "Opens permissions on every file" } : null;
}

function classifyGit(args: ReadonlyArray<string>): DestructiveCommand | null {
  // Skip global options such as `-C dir` or `-c key=value` before the subcommand.
  let index = 0;
  while (index < args.length && args[index]!.startsWith("-")) {
    index += args[index] === "-C" || args[index] === "-c" ? 2 : 1;
  }
  const subcommand = args[index];
  const rest = args.slice(index + 1);
  if (subcommand === "reset" && rest.includes("--hard")) {
    return { reason: "Discards local changes" };
  }
  if (subcommand === "clean") {
    const { flags } = splitFlags(rest);
    if ((flags.has("f") || flags.has("force")) && (flags.has("x") || flags.has("X"))) {
      return { reason: "Deletes untracked and ignored files" };
    }
    return null;
  }
  if (subcommand === "push") return classifyGitPush(rest);
  return null;
}

function classifyGitPush(args: ReadonlyArray<string>): DestructiveCommand | null {
  const { flags, operands } = splitFlags(
    args,
    new Set(["o", "push-option", "repo", "receive-pack"]),
  );
  const forced =
    flags.has("f") ||
    flags.has("force") ||
    flags.has("force-with-lease") ||
    flags.has("force-if-includes");
  // The first operand is the remote; the rest are refspecs.
  const refspecs = operands.slice(1);
  const forcedRefspec = refspecs.some((spec) => spec.startsWith("+") && targetsProtected(spec));
  if (forcedRefspec || (forced && (flags.has("mirror") || refspecs.some(targetsProtected)))) {
    return { reason: "Rewrites remote history" };
  }
  return null;
}

function targetsProtected(refspec: string): boolean {
  const target = refspec.replace(/^\+/, "").split(":").at(-1) ?? "";
  return PROTECTED_BRANCH.test(target.replace(/^refs\/heads\//, ""));
}

/** Paths whose recursive deletion takes out far more than a build folder. */
function isBroadPath(path: string): boolean {
  const normalized = path.replace(/\/+$/, "") || "/";
  if (
    ["/", "/*", "~", "~/*", "$HOME", "${HOME}", "$HOME/*", ".", "./*", "*", "..", "../*"].includes(
      normalized,
    )
  ) {
    return true;
  }
  // Top-level system folders such as /usr or /etc.
  return /^\/[^/*]+$/.test(normalized);
}

/** Separates option letters and long options from operands, honouring `--`. */
function splitFlags(
  args: ReadonlyArray<string>,
  optionsWithValues: ReadonlySet<string> = new Set(),
): { readonly flags: ReadonlySet<string>; readonly operands: ReadonlyArray<string> } {
  const flags = new Set<string>();
  const operands: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--") {
      operands.push(...args.slice(index + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const name = arg.slice(2).split("=")[0]!;
      flags.add(name);
      if (optionsWithValues.has(name) && !arg.includes("=")) index += 1;
    } else if (arg.startsWith("-") && arg.length > 1 && !/^-\d/.test(arg)) {
      for (const letter of arg.slice(1)) flags.add(letter);
      if (optionsWithValues.has(arg.slice(1))) index += 1;
    } else {
      operands.push(arg);
    }
  }
  return { flags, operands };
}

function stripPrefixes(words: ReadonlyArray<string>): ReadonlyArray<string> {
  let index = 0;
  while (index < words.length) {
    const word = words[index]!;
    if (ASSIGNMENT.test(word)) {
      index += 1;
    } else if (PREFIX_COMMANDS.has(word)) {
      index += 1;
      // Skip the prefix command's own options, e.g. `sudo -u root`.
      while (index < words.length && words[index]!.startsWith("-")) {
        index += words[index] === "-u" || words[index] === "-n" ? 2 : 1;
      }
    } else {
      break;
    }
  }
  return words.slice(index);
}

/**
 * Splits a shell line into simple commands of unquoted words. It is not a full
 * shell parser: it handles quotes, escapes and the usual separators, which is
 * enough to find the program and arguments of each command.
 */
function splitShellCommands(input: string): ReadonlyArray<ReadonlyArray<string>> {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let inWord = false;
  let quote: "'" | '"' | null = null;
  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"' && index + 1 < input.length) word += input[++index];
      else word += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      inWord = true;
    } else if (char === "\\" && index + 1 < input.length) {
      word += input[++index];
      inWord = true;
    } else if (
      char === ";" ||
      char === "|" ||
      char === "&" ||
      char === "\n" ||
      char === "(" ||
      char === ")"
    ) {
      endCommand();
    } else if (char === " " || char === "\t") {
      endWord();
    } else {
      word += char;
      inWord = true;
    }
  }
  endCommand();
  return commands;
}
