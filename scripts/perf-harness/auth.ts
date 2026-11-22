// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - pairs a browser with a throwaway server through its own CLI.
/**
 * Credentials for the harness's browser: a one-time pairing token from the
 * server's `auth pairing create` CLI against the scenario's home, exchanged in
 * a throwaway browser context for the session cookie. Cold contexts then carry
 * that cookie and nothing else.
 *
 * @module perf-harness/auth
 */
import * as NodePath from "node:path";

import type { Browser, Cookie } from "playwright-core";

import { newMeasuredContext, waitForMark, type MotionRequest } from "./browser.ts";
import { runNodeScript, serverBinPath } from "./serverProcess.ts";

/** The credential in `auth pairing create --json` output, which may follow log lines. */
function parsePairingCredentialOutput(output: string): string {
  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd < jsonStart) {
    throw new Error("the pairing command printed no JSON");
  }
  const parsed = JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as {
    readonly credential?: unknown;
  };
  if (typeof parsed.credential !== "string" || parsed.credential.length === 0) {
    throw new Error("the pairing command returned no credential");
  }
  return parsed.credential;
}

/** Issues a one-time pairing credential with standard client scopes. */
export async function issuePairingCredential(input: {
  readonly home: string;
  readonly env: Record<string, string>;
  readonly cwd: string;
  readonly logDir: string;
}): Promise<{ readonly credential: string; readonly pid: number }> {
  const { pid, lines } = await runNodeScript(
    [serverBinPath, "auth", "pairing", "create", "--base-dir", input.home, "--json"],
    { env: input.env, cwd: input.cwd, logPath: NodePath.join(input.logDir, "auth.log") },
  );
  return { credential: parsePairingCredentialOutput(lines.join("\n")), pid };
}

/**
 * Pairs a throwaway context through `/pair` on `origin` and returns its
 * cookies once the app has landed; fails if it lands anywhere else.
 */
export async function pairBrowser(
  browser: Browser,
  input: { readonly origin: string; readonly credential: string; readonly motion: MotionRequest },
): Promise<Array<Cookie>> {
  const context = await newMeasuredContext(browser, { cookies: [], motion: input.motion });
  try {
    const page = await context.newPage();
    const url = new URL("/pair", input.origin);
    url.hash = new URLSearchParams([["token", input.credential]]).toString();
    await page.goto(url.toString(), { waitUntil: "commit" });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const landing = await waitForMark(page, "e6:startup:landing:app", 2_000).catch(() => null);
      if (landing !== null) break;
    }
    const cookies = await context.cookies();
    if (!cookies.some((cookie) => cookie.name.startsWith("e6_session"))) {
      throw new Error(`pairing at ${input.origin} set no session cookie`);
    }
    return cookies;
  } finally {
    await context.close();
  }
}
