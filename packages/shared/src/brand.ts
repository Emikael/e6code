/**
 * Product identity for E6 Code. Environment names and the data directory
 * are the E6 names only.
 */
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";

export const PRODUCT_NAME = "E6 Code";
export const CLI_COMMAND = "e6";

const ENV_PREFIX = "E6CODE_";

export const DATA_DIR_NAME = ".e6";

export const GITHUB_REPOSITORY = "emikael/e6code";
export const NPM_PACKAGE_SCOPE = "@e6code";
export const HOSTED_APP_LATEST_ORIGIN = "https://latest.app.e6code.com";
export const HOSTED_APP_NIGHTLY_ORIGIN = "https://nightly.app.e6code.com";
// Public hosted app. app.e6code.com is not deployed; stable channel is the
// origin desktop, CLI, and local builds use until a router Worker exists.
export const HOSTED_APP_ORIGIN = HOSTED_APP_LATEST_ORIGIN;

function brandEnvName(suffix: string): string {
  return `${ENV_PREFIX}${suffix}`;
}

/**
 * Read one brand env value. Empty strings count as unset.
 */
export function readBrandEnv(
  env: Readonly<Record<string, string | undefined>>,
  suffix: string,
): string | undefined {
  const value = env[brandEnvName(suffix)]?.trim();
  return value || undefined;
}

/**
 * A blank string is a successful `Config.String`, so `orElse` would keep it.
 * Fail that case, then load the same name again so a blank-only value still
 * succeeds and a missing name stays missing for `Config.option` and
 * `Config.withDefault`.
 */
function rejectBlank<A>(config: Config.Config<A>): Config.Config<A> {
  return config.pipe(
    Config.mapEffect((value) =>
      typeof value === "string" && value.trim() === ""
        ? Effect.fail(new Config.ConfigError(new ConfigProvider.SourceError({ message: "blank" })))
        : Effect.succeed(value),
    ),
  );
}

/**
 * Effect Config for a brand variable. A usable `E6CODE_*` value wins. A
 * blank string is rejected and then loaded again so callers that trim it
 * still see the blank, and a missing name stays missing.
 */
export function withLegacyBrandEnv<A>(
  suffix: string,
  load: (name: string) => Config.Config<A>,
): Config.Config<A> {
  const name = brandEnvName(suffix);
  return rejectBlank(load(name)).pipe(Config.orElse(() => load(name)));
}

/**
 * Default data directory under a home or worktree. An existing `.e6` is
 * used; otherwise the caller creates `.e6`.
 */
export function resolveDefaultDataDir(input: {
  readonly parent: string;
  readonly join: (first: string, second: string) => string;
  readonly exists: (path: string) => boolean;
}): string {
  const next = input.join(input.parent, DATA_DIR_NAME);
  if (input.exists(next)) return next;
  return next;
}

export function cliExecutableFileNames(platform: NodeJS.Platform): readonly [string] {
  return platform === "win32" ? ["e6.exe"] : ["e6"];
}
