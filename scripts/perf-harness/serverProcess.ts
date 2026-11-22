// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - spawns, watches and stops host processes by the PID captured at spawn.
/**
 * Child processes of the web performance harness: the seed and auth CLIs and
 * one E6 server per scenario. Every child gets the run root's scrubbed
 * environment, its output is drained into a log, and it is stopped only by the
 * PID captured when it was spawned: SIGTERM, a bounded wait, then SIGKILL to
 * the same PID. Nothing is found or stopped by name.
 *
 * @module perf-harness/serverProcess
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodePerfHooks from "node:perf_hooks";
import * as NodeUtil from "node:util";

import { REPO_ROOT } from "./runRoot.ts";
import { readTraceRecords, type TraceRecord } from "./serverSignals.ts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const SERVER_BIN = NodePath.join(REPO_ROOT, "apps/server/src/bin.ts");
const READY_TIMEOUT_MS = 90_000;
const MAX_LINES = 4_000;
const KEPT_HEAD_LINES = 400;

export interface StopOutcome {
  readonly signal: "SIGTERM" | "SIGKILL";
  readonly exitedAfterMs: number | null;
  readonly forced: boolean;
}

const running = new Set<NodeChildProcess.ChildProcess>();

const hasExited = (child: NodeChildProcess.ChildProcess) =>
  child.exitCode !== null || child.signalCode !== null;

function waitForExit(child: NodeChildProcess.ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

/** SIGTERM to the PID captured at spawn, up to `timeoutMs`, then SIGKILL to that PID. */
async function stopProcess(
  child: NodeChildProcess.ChildProcess,
  timeoutMs: number,
): Promise<StopOutcome> {
  const startedAt = NodePerfHooks.performance.now();
  if (hasExited(child)) return { signal: "SIGTERM", exitedAfterMs: 0, forced: false };
  child.kill("SIGTERM");
  if (await waitForExit(child, timeoutMs)) {
    return {
      signal: "SIGTERM",
      exitedAfterMs: NodePerfHooks.performance.now() - startedAt,
      forced: false,
    };
  }
  child.kill("SIGKILL");
  const exited = await waitForExit(child, 5_000);
  return {
    signal: "SIGKILL",
    exitedAfterMs: exited ? NodePerfHooks.performance.now() - startedAt : null,
    forced: true,
  };
}

/** Stops every child still running, for the SIGINT/SIGTERM trap. */
export async function stopAllChildren(timeoutMs: number): Promise<void> {
  await Promise.all([...running].map((child) => stopProcess(child, timeoutMs)));
}

/** A free loopback port: bind port 0, read it, release it. */
function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("could not reserve a loopback port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

// The headless banner prints a pairing token and a QR code of the pairing URL; logs keep neither.
const redact = (line: string) =>
  /^[\s█▀▄]+$/u.test(line) && line.trim().length > 0
    ? "[qr code redacted]"
    : line.replace(/(Token:\s*)\S+/g, "$1[redacted]").replace(/(token=)[^&\s"]+/g, "$1[redacted]");

interface SpawnOptions {
  readonly env: Record<string, string>;
  readonly cwd: string;
  readonly logPath: string;
  /** Keep the output out of the log, for commands that print a secret such as a bearer token. */
  readonly secretOutput?: boolean;
}

function spawnLogged(args: ReadonlyArray<string>, options: SpawnOptions) {
  const child = NodeChildProcess.spawn(process.execPath, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  running.add(child);
  child.once("exit", () => running.delete(child));
  const log = NodeFS.createWriteStream(options.logPath, { flags: "a" });
  const lines: Array<string> = [];
  const onLine = (stream: "stdout" | "stderr") => {
    let pending = "";
    return (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      const parts = pending.split("\n");
      pending = parts.pop() ?? "";
      for (const line of parts) {
        lines.push(line);
        log.write(
          `[${stream}] ${options.secretOutput === true ? "[secret output]" : redact(line)}\n`,
        );
      }
      // Startup lines stay readable; a long run keeps only its recent tail in memory.
      if (lines.length > MAX_LINES) lines.splice(KEPT_HEAD_LINES, lines.length - MAX_LINES);
    };
  };
  child.stdout?.on("data", onLine("stdout"));
  child.stderr?.on("data", onLine("stderr"));
  child.once("exit", () => log.end());
  return { child, lines };
}

/** Runs a Node script to completion; rejects on a non-zero exit with the output's tail. */
export async function runNodeScript(
  args: ReadonlyArray<string>,
  options: SpawnOptions,
): Promise<{ readonly pid: number; readonly lines: ReadonlyArray<string>; readonly ms: number }> {
  const startedAt = NodePerfHooks.performance.now();
  const { child, lines } = spawnLogged(args, options);
  const pid = child.pid ?? 0;
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve(exitCode));
  });
  if (code !== 0) {
    const tail = options.secretOutput === true ? "[secret output]" : lines.slice(-8).join(" | ");
    throw new Error(
      `'${NodePath.basename(String(args[0]))} ${args.slice(1, 3).join(" ")}' exited with ${String(code)}: ${tail}`,
    );
  }
  return { pid, lines, ms: NodePerfHooks.performance.now() - startedAt };
}

export interface ServerHandle {
  readonly pid: number;
  readonly port: number;
  readonly origin: string;
  readonly readyMs: number;
  /** Server output lines so far (unredacted, in memory only). */
  readonly lines: ReadonlyArray<string>;
  readonly stop: (timeoutMs: number) => Promise<StopOutcome>;
  readonly rssKb: () => Promise<number | null>;
  /** Command names of the server's direct children, read with `ps`. */
  readonly childCommands: () => Promise<Array<string>>;
}

class PortInUseError extends Error {}

async function startServerOnce(input: {
  readonly home: string;
  readonly port: number;
  readonly env: Record<string, string>;
  readonly cwd: string;
  readonly logPath: string;
}): Promise<ServerHandle> {
  const startedAt = NodePerfHooks.performance.now();
  const { child, lines } = spawnLogged(
    [
      SERVER_BIN,
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      String(input.port),
      "--base-dir",
      input.home,
      "--no-browser",
      "--log-level",
      "info",
    ],
    input,
  );
  const pid = child.pid;
  if (pid === undefined) throw new Error("the server did not start");
  const origin = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`the server was not ready within ${READY_TIMEOUT_MS} ms`));
    }, READY_TIMEOUT_MS);
    const check = () => {
      if (!lines.some((line) => line.includes("E6 Code server is ready."))) return;
      const connection = lines.find((line) => line.startsWith("Connection string:"));
      if (connection === undefined) return;
      cleanup();
      resolve(connection.slice("Connection string:".length).trim().replace(/\/$/, ""));
    };
    const onExit = (code: number | null) => {
      cleanup();
      const tail = lines.slice(-12).join(" | ");
      reject(
        tail.includes("EADDRINUSE")
          ? new PortInUseError(tail)
          : new Error(`the server exited with ${String(code)} before it was ready: ${tail}`),
      );
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off("data", check);
      child.off("exit", onExit);
    };
    child.stdout?.on("data", check);
    child.once("exit", onExit);
  }).catch(async (error: unknown) => {
    await stopProcess(child, 5_000);
    throw error;
  });
  return {
    pid,
    port: input.port,
    origin,
    readyMs: NodePerfHooks.performance.now() - startedAt,
    lines,
    stop: (timeoutMs) => stopProcess(child, timeoutMs),
    rssKb: async () => {
      if (hasExited(child)) return null;
      const { stdout } = await execFile("ps", ["-o", "rss=", "-p", String(pid)]).catch(() => ({
        stdout: "",
      }));
      const kb = Number.parseInt(stdout.trim(), 10);
      return Number.isFinite(kb) ? kb : null;
    },
    childCommands: async () => {
      const { stdout } = await execFile("ps", ["-A", "-o", "pid=,ppid=,comm="]).catch(() => ({
        stdout: "",
      }));
      return stdout
        .split("\n")
        .map((line) => line.trim().split(/\s+/))
        .filter((fields) => fields[1] === String(pid))
        .map((fields) => NodePath.basename(fields.slice(2).join(" ")));
    },
  };
}

/** Starts `serve` on a probed port; retries once with a new port if the first was taken. */
export async function startServer(input: {
  readonly home: string;
  readonly env: Record<string, string>;
  readonly cwd: string;
  readonly logPath: string;
}): Promise<ServerHandle> {
  try {
    return await startServerOnce({ ...input, port: await reservePort() });
  } catch (error) {
    if (!(error instanceof PortInUseError)) throw error;
    return await startServerOnce({ ...input, port: await reservePort() });
  }
}

/** PIDs still listening on `port`, read with `lsof`; empty when nothing is. */
export async function listenersOn(port: number): Promise<Array<number>> {
  const { stdout } = await execFile("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).catch(
    () => ({ stdout: "" }),
  );
  return stdout
    .split("\n")
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isFinite(pid));
}

export const serverBinPath = SERVER_BIN;

/**
 * Every record in a stopped server's trace file and its rotated siblings
 * (`server.trace.ndjson.<n>`, oldest highest), with the files and bytes read.
 */
export async function readServerTrace(home: string): Promise<{
  readonly records: Array<TraceRecord>;
  readonly files: number;
  readonly bytes: number;
}> {
  const logs = NodePath.join(home, "userdata/logs");
  const names = (await NodeFSP.readdir(logs).catch((): Array<string> => [])).filter((name) =>
    /^server\.trace\.ndjson(\.\d+)?$/.test(name),
  );
  const records: Array<TraceRecord> = [];
  let bytes = 0;
  for (const name of names) {
    const text = await NodeFSP.readFile(NodePath.join(logs, name), "utf8");
    bytes += Buffer.byteLength(text);
    records.push(...readTraceRecords(text));
  }
  return { records, files: names.length, bytes };
}
