// @effect-diagnostics nodeBuiltinImport:off - launches the real browser/server outside an Effect runtime.
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { createServer, type ViteDevServer } from "vite-plus";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const repo = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../../../..",
);
const artifacts = NodePath.join(
  process.env.RUNNER_TEMP ?? NodeOS.tmpdir(),
  "e6-switchboard-browser-results",
);
const fixedTime = "2026-10-19T12:00:00.000Z";
const frontends: ViteDevServer[] = [];
let sandbox: string;
let currentUrl: string;
let mainUrl: string;
let browser: Browser;
let backend: ReturnType<typeof NodeChildProcess.spawn> | undefined;
const token = NodeCrypto.randomBytes(32).toString("hex");

async function freePort() {
  const server = NodeNet.createServer();
  await new Promise<void>((ready, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", ready);
  });
  const address = server.address();
  NodeAssert.ok(address && typeof address !== "string");
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return address.port;
}

/** Keep workspace imports on main's sources while reusing installed third-party packages. */
async function linkBaselineDependencies(baseline: string) {
  await NodeFSP.symlink(
    NodePath.join(repo, "node_modules"),
    NodePath.join(baseline, "node_modules"),
    "dir",
  );
  for (const group of ["apps", "packages"]) {
    for (const item of await NodeFSP.readdir(NodePath.join(baseline, group), {
      withFileTypes: true,
    })) {
      if (!item.isDirectory()) continue;
      const path = NodePath.join(group, item.name, "node_modules");
      const source = NodePath.join(repo, path);
      try {
        await NodeFSP.access(source);
      } catch {
        continue;
      }
      const target = NodePath.join(baseline, path);
      await NodeFSP.mkdir(target, { recursive: true });
      for (const entry of await NodeFSP.readdir(source)) {
        if (entry !== "@e6tools") {
          await NodeFSP.symlink(NodePath.join(source, entry), NodePath.join(target, entry), "dir");
          continue;
        }
        await NodeFSP.mkdir(NodePath.join(target, entry));
        for (const name of await NodeFSP.readdir(NodePath.join(source, entry))) {
          const original = await NodeFSP.realpath(NodePath.join(source, entry, name));
          const counterpart = NodePath.join(baseline, NodePath.relative(repo, original));
          let destination = counterpart;
          try {
            await NodeFSP.access(counterpart);
          } catch {
            destination = original;
          }
          await NodeFSP.symlink(destination, NodePath.join(target, entry, name), "dir");
        }
      }
    }
  }
}

async function frontend(root: string, name: string, backendPort: number) {
  process.env.E6CODE_SINGLE_ORIGIN_DEV = "1";
  process.env.E6CODE_PORT = String(backendPort);
  const server = await createServer({
    root: NodePath.join(root, "apps/web"),
    configFile: NodePath.join(root, "apps/web/vite.config.ts"),
    cacheDir: NodePath.join(sandbox, "node_modules", `.vite-${name}`),
    server: { host: "localhost", port: 0, fs: { allow: [repo, sandbox] } },
    logLevel: "error",
  });
  frontends.push(server);
  await server.listen();
  const address = server.httpServer?.address();
  NodeAssert.ok(address && typeof address !== "string");
  return `http://localhost:${address.port}`;
}

async function newContext(): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
    reducedMotion: "reduce",
    timezoneId: "UTC",
    locale: "en-US",
  });
  context.setDefaultTimeout(60_000);
  await context.addCookies([
    {
      name: `e6_dev_session_${NodeCrypto.createHash("sha256").update(token).digest("hex")}`,
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await context.addInitScript(
    ({ time }) => {
      localStorage.setItem(
        "e6code:client-settings:v1",
        JSON.stringify({ onboardingCompletedAt: time }),
      );
      localStorage.setItem(
        "e6code:ui-state:v1",
        JSON.stringify({
          sidebarSwitchboard: false,
          settingsSwitchboard: false,
          projectExpandedById: { "qa-project": true },
        }),
      );
    },
    { time: fixedTime },
  );
  return context;
}

NodeTest.before(
  async () => {
    try {
      sandbox = await NodeFSP.realpath(
        await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "e6-switchboard-browser-")),
      );
      await NodeFSP.mkdir(artifacts, { recursive: true });
      const baseline = NodePath.join(sandbox, "main");
      await NodeFSP.mkdir(baseline);
      const baseRef =
        process.env.E6CODE_VISUAL_BASE_REF ||
        (
          await exec("git", ["merge-base", "HEAD", "origin/main"], {
            cwd: repo,
          })
        ).stdout.trim();
      try {
        await exec("git", ["rev-parse", "--verify", `${baseRef}^{commit}`], {
          cwd: repo,
        });
      } catch {
        await exec("git", ["fetch", "--no-tags", "--depth=1", "origin", baseRef], { cwd: repo });
      }
      const archive = NodePath.join(sandbox, "main.tar");
      await exec(
        "git",
        [
          "archive",
          "--format=tar",
          `--output=${archive}`,
          baseRef,
          "apps/web",
          "packages",
          "scripts/lib",
          "package.json",
          "tsconfig.base.json",
          "third-party-licenses.config.json",
        ],
        { cwd: repo },
      );
      await exec("tar", ["-xf", archive, "-C", baseline]);
      await linkBaselineDependencies(baseline);
      const workspace = NodePath.join(sandbox, "project");
      await NodeFSP.mkdir(workspace);
      await exec("git", ["init", "--quiet", workspace]);
      const backendPort = await freePort();
      currentUrl = await frontend(repo, "current", backendPort);
      mainUrl = await frontend(baseline, "main", backendPort);
      backend = NodeChildProcess.spawn(
        process.execPath,
        [
          "apps/server/src/bin.ts",
          "start",
          "--mode",
          "web",
          "--host",
          "127.0.0.1",
          "--port",
          String(backendPort),
          "--base-dir",
          NodePath.join(sandbox, "home"),
          "--dev-url",
          currentUrl,
          "--no-browser",
          workspace,
        ],
        {
          cwd: repo,
          env: {
            ...process.env,
            E6CODE_DEV_AUTH_TOKEN: token,
            E6CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "false",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      await new Promise<void>((ready, reject) => {
        let log = "";
        const timeout = setTimeout(
          () => reject(new Error(`Test server readiness timeout: ${log}`)),
          90_000,
        );
        const accept = (data: Buffer) => {
          log = (log + data.toString().replace(/#token=\S+/g, "#token=[redacted]")).slice(-4000);
          if (log.includes("Listening on http://")) {
            clearTimeout(timeout);
            ready();
          }
        };
        backend!.stdout!.on("data", accept);
        backend!.stderr!.on("data", accept);
        backend!.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        backend!.once("exit", (code) => {
          clearTimeout(timeout);
          reject(new Error(`Test server exited ${code}: ${log}`));
        });
      });
      const dispatch = async (command: object) => {
        const response = await fetch(`http://127.0.0.1:${backendPort}/api/orchestration/dispatch`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(command),
        });
        NodeAssert.equal(response.status, 200, await response.text());
      };
      await dispatch({
        type: "project.create",
        commandId: "qa-project-create",
        projectId: "qa-project",
        title: "Switchboard QA",
        workspaceRoot: workspace,
        createdAt: fixedTime,
      });
      await dispatch({
        type: "thread.create",
        commandId: "qa-thread-create",
        threadId: "qa-thread",
        projectId: "qa-project",
        title: "Flags-off parity",
        modelSelection: { instanceId: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: fixedTime,
      });
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      await browser?.close().catch(() => {});
      await Promise.all(frontends.map((server) => server.close().catch(() => {})));
      frontends.length = 0;
      if (backend && backend.exitCode === null) {
        backend.kill("SIGKILL");
      }
      backend = undefined;
      if (sandbox) await NodeFSP.rm(sandbox, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  },
  { timeout: 180_000 },
);

NodeTest.after(async () => {
  await browser?.close();
  await Promise.all(frontends.map((server) => server.close()));
  if (backend && backend.exitCode === null) {
    const exited = new Promise<void>((done) => backend!.once("exit", () => done()));
    backend.kill("SIGTERM");
    await exited;
  }
  if (sandbox) await NodeFSP.rm(sandbox, { recursive: true, force: true });
});

NodeTest.test(
  "fixture has AA contrast and distinct muted text in every built-in/custom appearance",
  { timeout: 120_000 },
  async () => {
    const context = await newContext();
    try {
      const page = await context.newPage();
      await page.goto(`${currentUrl}/switchboard-fixture.html`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByRole("button", { name: "Run contrast audit" }).waitFor();
      const runAudit = () =>
        page.evaluate(async () => {
          const path = "/src/fixtures/SwitchboardFixture.tsx";
          const fixture = (await import(
            path
          )) as typeof import("../../src/fixtures/SwitchboardFixture");
          return fixture.runContrastAudit();
        });
      const builtins = await runAudit();
      await NodeFSP.writeFile(
        NodePath.join(artifacts, "contrast.json"),
        JSON.stringify({ builtins }, null, 2),
      );
      NodeAssert.equal(builtins.length, 12);
      for (const result of builtins) {
        NodeAssert.ok(result.checked > 0);
        NodeAssert.equal(result.mutedChecks.length, 2);
        NodeAssert.deepEqual(result.failures, [], JSON.stringify(result));
      }
      await page.evaluate(async () => {
        const path = "/src/themePalette.ts";
        const themes = (await import(path)) as typeof import("../../src/themePalette");
        themes.installCustomTheme({
          id: "qa-custom",
          label: "QA custom",
          appearance: "light",
          colors: {
            ...themes.getDefaultThemeColors("light"),
            canvas: "#ffffff",
            text: "#111111",
            sidebar: "#f5f5f5",
            sidebarForeground: "#111111",
          },
          variants: {
            dark: {
              ...themes.getDefaultThemeColors("dark"),
              canvas: "#111111",
              text: "#f5f5f5",
              sidebar: "#171717",
              sidebarForeground: "#f5f5f5",
            },
          },
        });
      });
      const custom = await runAudit();
      NodeAssert.equal(custom.length, 14);
      NodeAssert.equal(custom.filter((result) => result.theme === "qa-custom").length, 2);
      for (const result of custom)
        NodeAssert.deepEqual(result.failures, [], JSON.stringify(result));
      await page.evaluate(async () => {
        const path = "/src/themePalette.ts";
        const themes = (await import(path)) as typeof import("../../src/themePalette");
        const light = themes.getDefaultThemeColors("light");
        themes.installCustomTheme({
          id: "qa-failing",
          label: "QA failing",
          appearance: "light",
          colors: {
            ...light,
            text: light.canvas,
            sidebarForeground: light.sidebar,
          },
          variants: { dark: themes.getDefaultThemeColors("dark") },
        });
      });
      const invalid = await runAudit();
      NodeAssert.ok(
        invalid.some((result) => result.theme === "qa-failing" && result.failures.length > 0),
        "The audit must reject unreadable custom themes",
      );
      const before = await page.evaluate(() => localStorage.getItem("e6code:ui-state:v1"));
      await page.locator('[aria-label="Group by"]').selectOption("status");
      await page.locator('[aria-label="Density"]').selectOption("compact");
      await page.getByRole("button", { name: "feature/switchboard, 3 threads" }).click();
      NodeAssert.equal(
        await page.evaluate(() => localStorage.getItem("e6code:ui-state:v1")),
        before,
        "Fixture interactions must not write application preferences",
      );
      await NodeFSP.writeFile(
        NodePath.join(artifacts, "contrast.json"),
        JSON.stringify({ builtins, custom }, null, 2),
      );
    } finally {
      await context.close();
    }
  },
);

NodeTest.test(
  "muted-distinction rejects --sb-muted at 90% foreground",
  { timeout: 120_000 },
  async () => {
    const context = await newContext();
    try {
      const page = await context.newPage();
      await page.goto(`${currentUrl}/switchboard-fixture.html`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByRole("button", { name: "Run contrast audit" }).waitFor();
      await page.addStyleTag({
        content:
          "[data-switchboard] { --sb-muted: color-mix(in srgb, var(--sb-foreground) 90%, var(--sb-surface)) !important; }",
      });
      const results = await page.evaluate(async () => {
        const path = "/src/fixtures/SwitchboardFixture.tsx";
        const fixture = (await import(
          path
        )) as typeof import("../../src/fixtures/SwitchboardFixture");
        return fixture.runContrastAudit();
      });
      NodeAssert.ok(
        results.some((result) =>
          result.failures.some((failure) => failure.category === "muted-distinction"),
        ),
        "90% --sb-muted must fail muted-distinction",
      );
    } finally {
      await context.close();
    }
  },
);

async function snapshot(context: BrowserContext, url: string, surface: "sidebar" | "settings") {
  const page: Page = await context.newPage();
  try {
    await page.clock.setFixedTime(new Date(fixedTime));
    await page.goto(`${url}${surface === "sidebar" ? "/" : "/settings/general"}`);
    await page
      .getByText(surface === "sidebar" ? "Flags-off parity" : "Restore device defaults", {
        exact: true,
      })
      .first()
      .waitFor({ state: "visible", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(1400, 890);
    const options = {
      animations: "disabled",
      caret: "hide",
      scale: "css",
    } as const;
    return surface === "sidebar"
      ? await page.locator('[data-slot="sidebar-inner"]').screenshot(options)
      : await page.screenshot(options);
  } catch (error) {
    await page.screenshot({
      path: NodePath.join(artifacts, `${surface}-failure.png`),
    });
    throw error;
  } finally {
    await page.close();
  }
}

NodeTest.test(
  "flags-off sidebar and settings snapshots are pixel-identical to main",
  { timeout: 180_000 },
  async () => {
    const context = await newContext();
    try {
      for (const surface of ["sidebar", "settings"] as const) {
        const expected = await snapshot(context, mainUrl, surface);
        const actual = await snapshot(context, currentUrl, surface);
        await NodeFSP.writeFile(NodePath.join(artifacts, `${surface}-main.png`), expected);
        await NodeFSP.writeFile(NodePath.join(artifacts, `${surface}-current.png`), actual);
        NodeAssert.ok(
          actual.equals(expected),
          `${surface} flags-off screenshot differs from main; inspect ${artifacts}`,
        );
      }
    } finally {
      await context.close();
    }
  },
);
