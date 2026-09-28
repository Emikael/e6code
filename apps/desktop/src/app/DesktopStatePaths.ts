// @effect-diagnostics-next-line nodeBuiltinImport:off - Early desktop startup resolves the data directory before an Effect filesystem service exists.
import * as NodeFS from "node:fs";

import { resolveDefaultDataDir } from "@e6tools/shared/brand";
import * as Option from "effect/Option";

export type JoinPath = (first: string, ...segments: string[]) => string;

function normalizeConfiguredBaseDir(e6Home: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(e6Home)) {
    return Option.none();
  }
  const trimmed = e6Home.value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly e6Home: Option.Option<string>;
  readonly exists?: (path: string) => boolean;
}): string {
  return Option.getOrElse(normalizeConfiguredBaseDir(input.e6Home), () =>
    resolveDefaultDataDir({
      parent: input.homeDirectory,
      join: input.joinPath,
      exists: input.exists ?? NodeFS.existsSync,
    }),
  );
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly e6Home: Option.Option<string>;
}): string {
  const useDevSubdir =
    input.isDevelopment && Option.isNone(normalizeConfiguredBaseDir(input.e6Home));
  return input.joinPath(input.baseDir, useDevSubdir ? "dev" : "userdata");
}
