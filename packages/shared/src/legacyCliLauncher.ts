/**
 * `dist/bin.mjs` of the `e6` npm package: the entry point boot-service
 * launchers installed before 0.0.41 run with Node to start a new version they
 * just npm-installed. It forwards everything (arguments, stdio, the IPC
 * channel the launcher talks over, signals, exit status) to the platform
 * executable in the sibling `@e6code/e6-<platform>-<arch>` package.
 *
 * The first server started this way rewrites the service unit to run the
 * executable directly, so nothing depends on this file after one update.
 * Remove it once no supported release predates the executable (after the
 * first stable release that ships it).
 */
import { CLI_COMMAND, cliExecutableFileNames, NPM_PACKAGE_SCOPE } from "./brand.ts";

export function legacyCliLauncherScript(): string {
  const unixNames = JSON.stringify(cliExecutableFileNames("linux"));
  const windowsNames = JSON.stringify(cliExecutableFileNames("win32"));
  const packageNames = JSON.stringify([CLI_COMMAND]);
  return `import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { constants } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const executableNames = process.platform === "win32" ? ${windowsNames} : ${unixNames};
const packageNames = ${packageNames};
let executable;
for (const packageName of packageNames) {
  let packageDir;
  try {
    packageDir = dirname(require.resolve(${JSON.stringify(NPM_PACKAGE_SCOPE)} + "/" + packageName + "-" + process.platform + "-" + process.arch + "/package.json"));
  } catch {
    continue;
  }
  for (const executableName of executableNames) {
    const candidate = join(packageDir, executableName);
    if (existsSync(candidate)) {
      executable = candidate;
      break;
    }
  }
  if (executable) break;
}
if (!executable) {
  process.stderr.write("e6: no E6 Code CLI build is available for this platform.\\n");
  process.exit(1);
}
const ipc = process.send !== undefined;
const child = spawn(executable, process.argv.slice(2), {
  stdio: ipc ? ["inherit", "inherit", "inherit", "ipc"] : "inherit",
});
const fail = (error) => {
  if (!error) return;
  process.stderr.write("e6: " + error.message + "\\n");
  child.kill("SIGTERM");
  process.exitCode = 1;
};
if (ipc) {
  process.on("message", (message) => { if (child.connected) child.send(message, fail); });
  child.on("message", (message) => { if (process.connected) process.send(message, fail); });
  process.on("disconnect", () => { if (child.connected) child.disconnect(); });
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => { fail(error); process.exit(1); });
child.on("exit", (code, signal) => process.exit(code ?? 128 + (constants.signals[signal] || 1)));
`;
}
