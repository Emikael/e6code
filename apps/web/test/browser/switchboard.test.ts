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
import { DEFAULT_MODEL } from "@e6tools/contracts";
import type { OrchestrationShellSnapshot } from "@e6tools/contracts";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright-core";
import type { AxeResults } from "axe-core";
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
let backendPort = 0;
let backend: ReturnType<typeof NodeChildProcess.spawn> | undefined;
let backendLogWrite = Promise.resolve();
const token = NodeCrypto.randomBytes(32).toString("hex");

function recordBackendLog(message: string) {
  backendLogWrite = backendLogWrite.then(() =>
    NodeFSP.appendFile(
      NodePath.join(artifacts, "backend.log"),
      `${message.replace(/#token=\S+/g, "#token=[redacted]")}\n`,
    ),
  );
}

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

async function newContext(options?: { readonly switchboard?: boolean }): Promise<BrowserContext> {
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
    ({ time, switchboard }) => {
      localStorage.setItem(
        "e6code:client-settings:v1",
        JSON.stringify({ onboardingCompletedAt: time }),
      );
      localStorage.setItem(
        "e6code:ui-state:v1",
        JSON.stringify({
          sidebarSwitchboard: switchboard,
          settingsSwitchboard: false,
          projectExpandedById: { "qa-project": true },
        }),
      );
    },
    { time: fixedTime, switchboard: options?.switchboard === true },
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
      backendPort = await freePort();
      currentUrl = await frontend(repo, "current", backendPort);
      mainUrl = await frontend(baseline, "main", backendPort);
      await NodeFSP.writeFile(NodePath.join(artifacts, "backend.log"), "");
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
      for (const [name, stream] of [
        ["stdout", backend.stdout!],
        ["stderr", backend.stderr!],
      ] as const) {
        let pending = "";
        stream.on("data", (data: Buffer) => {
          const lines = (pending + data.toString()).split("\n");
          pending = lines.pop() ?? "";
          for (const line of lines) recordBackendLog(`[${name}] ${line}`);
        });
        stream.on("end", () => {
          if (pending) recordBackendLog(`[${name}] ${pending}`);
        });
      }
      backend.once("exit", (code, signal) =>
        recordBackendLog(`[exit] code=${code} signal=${signal}`),
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
  await backendLogWrite;
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
    if (surface === "settings") {
      // The header is static. These rows appear only after server settings hydrate
      // and they change the page height, so both builds must reach them first.
      await page.locator("#default-model").getByText("Automatic", { exact: true }).waitFor({
        state: "visible",
        timeout: 60_000,
      });
      await page.getByRole("heading", { name: "Auto-settle merged threads", exact: true }).waitFor({
        state: "visible",
        timeout: 60_000,
      });
    }
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
  "flag-on sidebar shows the project rail, masthead, footer, and sort picker",
  { timeout: 180_000 },
  async () => {
    const context = await newContext({ switchboard: true });
    try {
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date(fixedTime));
      await page.goto(`${currentUrl}/`);
      await page.getByRole("navigation", { name: "Projects" }).waitFor();
      await page.getByRole("heading", { name: "All projects" }).waitFor();
      const project = page
        .getByRole("navigation", { name: "Projects" })
        .getByRole("button", { name: "Switchboard QA", exact: true });
      await project.waitFor();
      await project.click();
      await page.getByRole("heading", { name: "Switchboard QA", exact: true }).waitFor();
      await page.getByRole("button", { name: /^\d+ threads, filter$/ }).waitFor();
      await page
        .locator("[data-switchboard='sidebar']")
        .first()
        .screenshot({
          path: NodePath.join(artifacts, "flag-on-sidebar.png"),
          animations: "disabled",
        });
      await page.getByRole("button", { name: "Sort projects" }).click();
      await page.getByRole("menuitemradio", { name: "Last user message" }).waitFor();
      await page.getByRole("menuitemradio", { name: "Created at" }).waitFor();
      await page.getByRole("menuitemradio", { name: "Manual" }).waitFor();
      await page.screenshot({
        path: NodePath.join(artifacts, "flag-on-sort-picker.png"),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");

      // thread.activity.append is not a client command, so the fixture stays at
      // zero need-you threads and the rail renders no badge. The specimen uses
      // the production pill classes on that real tile.
      const projectTile = page
        .getByRole("navigation", { name: "Projects" })
        .getByRole("button", { name: "Switchboard QA", exact: true });
      NodeAssert.equal(await projectTile.locator("span.ring-2").count(), 0);
      await projectTile.evaluate((button) => {
        const badge = document.createElement("span");
        badge.setAttribute("data-badge-specimen", "");
        // Like the production badge: the tile's name comes from its hidden label.
        badge.setAttribute("aria-hidden", "true");
        badge.textContent = "1";
        badge.className =
          "absolute -right-0.5 -bottom-0.5 h-4 min-w-4 rounded-full px-1 text-center font-mono text-(length:--sb-text-meta) leading-4 font-semibold tabular-nums ring-2 ring-sb-rail-bg";
        badge.style.backgroundColor = "var(--state-approval)";
        badge.style.color = "var(--sb-rail-bg)";
        button.append(badge);
      });
      await projectTile.screenshot({
        path: NodePath.join(artifacts, "flag-on-badge.png"),
        animations: "disabled",
      });
      await projectTile.locator("[data-badge-specimen]").evaluate((badge) => badge.remove());

      await page.evaluate(() => {
        localStorage.setItem("switchboard_column_width", "256");
      });
      await page.reload();
      await page.getByRole("navigation", { name: "Projects" }).waitFor();
      await page
        .getByRole("navigation", { name: "Projects" })
        .getByRole("button", { name: "Switchboard QA", exact: true })
        .click();
      const needYou = page.getByRole("button", { name: /need you, filter$/ });
      await needYou.waitFor();
      NodeAssert.equal(
        await needYou
          .locator("span")
          .last()
          .evaluate((node) => node.getClientRects().length),
        1,
        "The need-you label wraps at the 256px column",
      );
      // A real Electron bridge changes auth bootstrap. The macOS inset is the
      // same CSS variable the desktop shell sets, so simulate that here.
      await page.evaluate(() => {
        document.documentElement.style.setProperty("--workspace-controls-left", "90px");
      });
      const titleWrap = page.locator("[data-switchboard='sidebar'] header h2").locator("..");
      const titleWidth = await titleWrap.evaluate((node) => node.getBoundingClientRect().width);
      NodeAssert.ok(titleWidth >= 72, `Masthead title collapsed to ${titleWidth}px`);
      const actions = page.getByRole("button", { name: "Project actions" });
      const column = page.locator("[data-switchboard='sidebar']").first();
      const [actionsBox, columnBox] = await Promise.all([
        actions.boundingBox(),
        column.boundingBox(),
      ]);
      NodeAssert.ok(actionsBox && columnBox);
      NodeAssert.ok(
        actionsBox.x + actionsBox.width <= columnBox.x + columnBox.width + 1,
        `Project actions overflow the column: ${JSON.stringify({ actionsBox, columnBox })}`,
      );
      await page.locator("[data-switchboard='sidebar'] header").screenshot({
        path: NodePath.join(artifacts, "flag-on-masthead-256.png"),
        animations: "disabled",
      });
      await actions.click();
      await page.getByRole("menuitem", { name: "Reveal in file manager" }).waitFor();
      await page.screenshot({
        path: NodePath.join(artifacts, "flag-on-project-actions.png"),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      const toggle = page.getByRole("button", { name: "Toggle main sidebar" });
      const home = page.getByRole("button", { name: /Go to threads/ });
      const title = page.getByRole("heading", { name: "Switchboard QA", exact: true });
      const [toggleBox, homeBox, titleBox] = await Promise.all([
        toggle.boundingBox(),
        home.boundingBox(),
        title.boundingBox(),
      ]);
      NodeAssert.ok(toggleBox && homeBox && titleBox);
      NodeAssert.ok(
        homeBox.y >= toggleBox.y + toggleBox.height - 1,
        `Home mark overlaps the sidebar toggle: ${JSON.stringify({ toggleBox, homeBox })}`,
      );
      NodeAssert.ok(
        titleBox.x >= toggleBox.x + toggleBox.width - 1,
        `Masthead title overlaps the sidebar toggle: ${JSON.stringify({ toggleBox, titleBox })}`,
      );
      await page
        .locator("[data-switchboard='sidebar']")
        .first()
        .screenshot({
          path: NodePath.join(artifacts, "flag-on-macos-inset.png"),
          animations: "disabled",
        });

      const mobile = await context.newPage();
      await mobile.setViewportSize({ width: 390, height: 844 });
      await mobile.clock.setFixedTime(new Date(fixedTime));
      await mobile.goto(`${currentUrl}/`);
      await mobile.getByRole("button", { name: "Toggle main sidebar" }).click();
      const strip = mobile.getByRole("navigation", { name: "Projects" });
      await strip.waitFor();
      const addBox = await strip.getByRole("button", { name: "Add project" }).boundingBox();
      const sortBox = await mobile.getByRole("button", { name: "Sort projects" }).boundingBox();
      NodeAssert.ok(addBox && sortBox);
      NodeAssert.ok(
        addBox.x + addBox.width <= sortBox.x + 1,
        `Add project overlaps Sort: ${JSON.stringify({ addBox, sortBox })}`,
      );
      NodeAssert.ok(sortBox.width >= 24, `Sort projects is ${sortBox.width}px wide`);
      const stripOverflow = await strip.evaluate((node) => node.scrollWidth - node.clientWidth);
      NodeAssert.ok(stripOverflow <= 1, `Mobile strip overflows by ${stripOverflow}px`);
      await strip.screenshot({
        path: NodePath.join(artifacts, "flag-on-mobile-strip.png"),
        animations: "disabled",
      });
      await mobile.close();
    } finally {
      await context.close();
    }
  },
);

async function dispatchFixture(command: object) {
  const response = await fetch(`http://127.0.0.1:${backendPort}/api/orchestration/dispatch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  NodeAssert.equal(response.status, 200, await response.text());
}

async function readShell(): Promise<OrchestrationShellSnapshot> {
  const response = await fetch(`http://127.0.0.1:${backendPort}/api/orchestration/shell`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  NodeAssert.equal(response.status, 200);
  return response.json();
}

async function browserRpc(page: Page, method: string, payload: object): Promise<unknown> {
  return page.evaluate(
    ({ method, payload }) =>
      new Promise((resolve, reject) => {
        const url = new URL("/ws", location.href);
        url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const socket = new WebSocket(url);
        // Each call sends one request on its own socket.
        const id = "1";
        socket.addEventListener("open", () =>
          socket.send(
            JSON.stringify({
              _tag: "Request",
              id,
              tag: method,
              payload,
              headers: [],
            }),
          ),
        );
        socket.addEventListener("error", () => reject(new Error(`RPC ${method} disconnected`)));
        socket.addEventListener("close", () =>
          reject(new Error(`RPC ${method} closed before its receipt`)),
        );
        socket.addEventListener("message", ({ data }) => {
          const message = JSON.parse(String(data));
          if (message._tag !== "Exit" || message.requestId !== id) return;
          socket.close();
          if (message.exit._tag === "Success") resolve(message.exit.value);
          else reject(new Error(`RPC ${method} failed: ${JSON.stringify(message.exit)}`));
        });
      }),
    { method, payload },
  );
}

function observeThreadWrites(page: Page) {
  const commands: Array<Record<string, unknown>> = [];
  const waiters = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  page.on("websocket", (socket) => {
    const pending = new Map<string, Record<string, unknown>>();
    socket.on("framesent", ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message._tag !== "Request" || message.tag !== "orchestration.dispatchCommand") return;
      commands.push(message.payload);
      pending.set(String(message.id), message.payload);
    });
    socket.on("framereceived", ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message._tag !== "Exit") return;
      const command = pending.get(String(message.requestId));
      if (!command) return;
      pending.delete(String(message.requestId));
      const waiter = waiters.get(String(command.type));
      if (!waiter) return;
      waiters.delete(String(command.type));
      if (message.exit._tag === "Success") waiter.resolve();
      else waiter.reject(new Error(`Thread command failed: ${JSON.stringify(message.exit)}`));
    });
  });
  return {
    commands,
    // The deadline only names a write that never comes; passing never waits on it.
    next: (type: string) =>
      new Promise<void>((resolve, reject) => {
        NodeAssert.equal(waiters.has(type), false);
        const deadline = setTimeout(() => {
          waiters.delete(type);
          const sent = commands.map((command) => command.type).join(", ");
          reject(new Error(`No ${type} write completed within 45s; sent: ${sent}`));
        }, 45_000);
        waiters.set(type, {
          resolve: () => {
            clearTimeout(deadline);
            resolve();
          },
          reject: (error) => {
            clearTimeout(deadline);
            reject(error);
          },
        });
      }),
  };
}

async function startRowDrag(page: Page, source: Locator) {
  await source.scrollIntoViewIfNeeded();
  const box = await source.boundingBox();
  NodeAssert.ok(box);
  const x = box.x + Math.min(60, box.width / 2);
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y + 2, { steps: 3 });
  await page.locator("[data-sb-drag-overlay]").waitFor();
  return { x: x + 12, y: y + 2 };
}

/** dnd-kit's live region, while it announces `text`. */
function dndAnnouncement(page: Page, text: string) {
  return page.locator('[id^="DndLiveRegion"]').filter({ hasText: text });
}

/** The drop indicator sits beside the row element, inside the row's list item. */
function dropIndicatorOn(row: Locator) {
  return row.locator("xpath=..").locator(":scope > [data-sb-drop-indicator]");
}

/** Rows are named by their content, which starts with the title. */
function optionName(title: string) {
  return new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
}

async function moveDragTo(page: Page, target: Locator, fraction = 0.5, followScroll = false) {
  // Sortable rows shift to preview the drop, so only re-aim at targets that
  // move because the list auto-scrolled near its edge.
  let point = { x: 0, y: 0 };
  for (let attempt = 0; attempt < (followScroll ? 5 : 1); attempt += 1) {
    const box = await target.boundingBox();
    NodeAssert.ok(box);
    const inside =
      point.x >= box.x &&
      point.x <= box.x + box.width &&
      point.y >= box.y &&
      point.y <= box.y + box.height;
    if (attempt > 0 && inside) return point;
    point = { x: box.x + box.width / 2, y: box.y + box.height * fraction };
    await page.mouse.move(point.x, point.y, { steps: 12 });
  }
  return point;
}

async function seedBranchProject(id: string, pinned = true) {
  const root = NodePath.join(sandbox, id);
  const worktree = NodePath.join(sandbox, `${id}-worktree`);
  await NodeFSP.mkdir(root);
  await exec("git", ["init", "--quiet", root]);
  await exec(
    "git",
    [
      "-c",
      "user.name=Switchboard QA",
      "-c",
      "user.email=qa@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "Browser fixture",
    ],
    { cwd: root },
  );
  await exec("git", ["branch", "feature/alpha"], { cwd: root });
  await exec("git", ["branch", "feature/beta"], { cwd: root });
  await exec("git", ["worktree", "add", "--quiet", worktree, "feature/alpha"], { cwd: root });
  const title = `Branch QA ${id}`;
  await dispatchFixture({
    type: "project.create",
    commandId: `${id}-project-create`,
    projectId: id,
    title,
    workspaceRoot: root,
    createdAt: fixedTime,
  });
  const rows = {
    pinFirst: { title: "Pinned first", branch: "feature/alpha", minute: 1 },
    pinSecond: { title: "Pinned second", branch: "feature/beta", minute: 2 },
    alphaFirst: { title: "Alpha first", branch: "feature/alpha", minute: 3 },
    alphaSecond: { title: "Alpha second", branch: "feature/alpha", minute: 4 },
    beta: { title: "Beta thread", branch: "feature/beta", minute: 5 },
    worktree: { title: "Alpha worktree", branch: "feature/alpha", minute: 6 },
    noBranch: { title: "No branch thread", branch: null, minute: 0 },
    snoozed: { title: "Snoozed thread", branch: "feature/beta", minute: 7 },
    settled: { title: "Settled thread", branch: "feature/beta", minute: 8 },
  } as const;
  const threadId = (key: keyof typeof rows) => `${id}-${key}`;
  // The server stamps createdAt itself, so dispatch order is what sets lane recency.
  const byMinute = Object.entries(rows).toSorted(([, a], [, b]) => a.minute - b.minute);
  for (const [key, row] of byMinute) {
    if (!pinned && (key === "pinFirst" || key === "pinSecond")) continue;
    await dispatchFixture({
      type: "thread.create",
      commandId: `${id}-${key}-create`,
      threadId: `${id}-${key}`,
      projectId: id,
      title: row.title,
      modelSelection: { instanceId: "codex", model: DEFAULT_MODEL },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: row.branch,
      worktreePath: key === "worktree" ? worktree : null,
      createdAt: new Date(Date.parse(fixedTime) + row.minute * 60_000).toISOString(),
    });
  }
  // Interleaving branches makes visual lane order differ from the global order.
  for (const [key, orderKey] of [
    ["noBranch", "b"],
    ["alphaFirst", "f"],
    ["beta", "m"],
    ["alphaSecond", "t"],
    ["worktree", "z"],
  ] as const) {
    await dispatchFixture({
      type: "thread.active.reorder",
      commandId: `${id}-${key}-order`,
      threadId: threadId(key),
      orderKey,
    });
  }
  if (pinned) {
    for (const [key, orderKey] of [
      ["pinFirst", "t"],
      ["pinSecond", "f"],
    ] as const) {
      await dispatchFixture({
        type: "thread.pin",
        commandId: `${id}-${key}-pin`,
        threadId: threadId(key),
        orderKey,
      });
    }
  }
  await dispatchFixture({
    type: "thread.snooze",
    commandId: `${id}-snooze`,
    threadId: threadId("snoozed"),
    snoozedUntil: "2099-01-01T00:00:00.000Z",
  });
  await dispatchFixture({
    type: "thread.settle",
    commandId: `${id}-settle`,
    threadId: threadId("settled"),
  });
  return { id, title, worktree, rows, threadId };
}

async function openBranchProject(
  page: Page,
  project: Awaited<ReturnType<typeof seedBranchProject>>,
) {
  await page.clock.setFixedTime(new Date(fixedTime));
  await page.goto(`${currentUrl}/`);
  try {
    await page
      .getByRole("navigation", { name: "Projects" })
      .getByRole("button", { name: project.title, exact: true })
      .click();
  } catch (cause) {
    await page.screenshot({ path: NodePath.join(artifacts, `${project.id}-failure.png`) });
    throw new Error(
      `Project navigation unavailable at ${page.url()}: ${await page.locator("body").innerText()}`,
      { cause },
    );
  }
  await page.getByRole("heading", { name: project.title, exact: true }).waitFor();
  return page.locator('[data-switchboard="sidebar"]').first();
}

/** Critical and serious axe violations inside `selector`, as readable lines. */
async function seriousAxeViolations(page: Page, selector: string): Promise<string[]> {
  await page.addScriptTag({
    path: NodeURL.fileURLToPath(import.meta.resolve("axe-core/axe.min.js")),
  });
  const violations = await page.evaluate(async (scope) => {
    const { axe } = window as unknown as {
      axe: { run: (context: Element, options: object) => Promise<AxeResults> };
    };
    const root = document.querySelector(scope);
    if (!root) throw new Error(`No axe scope ${scope}`);
    const result = await axe.run(root, { resultTypes: ["violations"] });
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => {
        const related = [...node.any, ...node.all, ...node.none]
          .flatMap((check) => check.relatedNodes ?? [])
          .slice(0, 3)
          .map((relatedNode) => relatedNode.html.slice(0, 160));
        return `${node.html.slice(0, 160)} ${node.failureSummary ?? ""} Related: ${related.join(" | ")}`.replace(
          /\s+/g,
          " ",
        );
      }),
    }));
  }, selector);
  return violations
    .filter(({ impact }) => impact === "critical" || impact === "serious")
    .flatMap(({ id, impact, nodes }) => nodes.map((node) => `${impact} ${id} ${node}`));
}

NodeTest.test(
  "branch lanes have no critical or serious axe violations",
  { timeout: 180_000 },
  async () => {
    const project = await seedBranchProject("qa-branch-a11y");
    const context = await newContext({ switchboard: true });
    try {
      const page = await context.newPage();
      const sidebar = await openBranchProject(page, project);
      await sidebar.getByRole("group", { name: "Pinned, 2 threads", exact: true }).waitFor();
      await sidebar.getByTestId("sidebar-snoozed-shelf-toggle").click();
      await sidebar.getByTestId("sidebar-settled-shelf-toggle").click();
      await sidebar.getByText("Settled thread", { exact: true }).waitFor();
      // Audit the resting sidebar: hovering a row reveals its actions (tab stops are C10).
      await page.mouse.move(1000, 450);
      const scope = '[data-switchboard="sidebar"]';
      NodeAssert.deepEqual(await seriousAxeViolations(page, scope), []);
    } finally {
      await context.close();
    }
  },
);

NodeTest.test(
  "branch lanes keep worktrees distinct and navigation follows visual order",
  { timeout: 180_000 },
  async () => {
    const project = await seedBranchProject("qa-branch-navigation");
    const context = await newContext({ switchboard: true });
    let page: Page | undefined;
    const jumpBindings = Array.from({ length: 9 }, (_, index) => ({
      key: `mod+${index + 1}`,
      command: `thread.jump.${index + 1}`,
      when: "isWeb",
    }));
    const installedBindings: typeof jumpBindings = [];
    try {
      page = await context.newPage();
      const sidebar = await openBranchProject(page, project);
      await sidebar.getByRole("group", { name: "Pinned, 2 threads", exact: true }).waitFor();
      await sidebar.getByRole("group", { name: "feature/beta, 1 thread", exact: true }).waitFor();
      await sidebar.getByRole("group", { name: "feature/alpha, 2 threads", exact: true }).waitFor();
      await sidebar.getByRole("group", { name: "No branch, 1 thread", exact: true }).waitFor();
      const lanes = sidebar.locator("[data-sb-branch-lane]");
      const keys = await lanes.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-sb-branch-lane")),
      );
      const localAlphaKey = keys.find((key) => key?.endsWith(`${project.id}:br:feature/alpha`));
      NodeAssert.ok(localAlphaKey, `Missing local alpha lane: ${JSON.stringify(keys)}`);
      const environmentId = localAlphaKey.slice(0, -`${project.id}:br:feature/alpha`.length - 1);
      NodeAssert.deepEqual(
        keys.filter((key) => key !== null && key.includes(`:${project.id}:`)),
        [
          `${environmentId}:${project.id}:wt:${project.worktree}`,
          `${environmentId}:${project.id}:br:feature/beta`,
          localAlphaKey,
          `${environmentId}:${project.id}:none`,
        ],
      );
      const worktreeLane = sidebar.locator(
        `[data-sb-branch-lane="${environmentId}:${project.id}:wt:${project.worktree}"]`,
      );
      NodeAssert.equal(await worktreeLane.getAttribute("aria-label"), "feature/alpha, 1 thread");
      await worktreeLane.getByText("worktree", { exact: true }).waitFor();
      const alphaLane = sidebar.getByRole("group", {
        name: "feature/alpha, 2 threads",
        exact: true,
      });
      NodeAssert.deepEqual(
        await alphaLane
          .getByRole("option")
          .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-sb-thread-row"))),
        (["alphaFirst", "alphaSecond"] as const).map(
          (key) => `${environmentId}:${project.threadId(key)}`,
        ),
      );

      await sidebar.getByTestId("sidebar-snoozed-shelf-toggle").click();
      await sidebar.getByTestId("sidebar-settled-shelf-toggle").click();
      const order = [
        "pinSecond",
        "pinFirst",
        "worktree",
        "beta",
        "alphaFirst",
        "alphaSecond",
        "noBranch",
        "snoozed",
        "settled",
      ] as const;
      const row = (key: keyof typeof project.rows) =>
        sidebar.locator(`[data-sb-thread-row="${environmentId}:${project.threadId(key)}"]`);
      await row("settled").waitFor();
      NodeAssert.deepEqual(
        await sidebar
          .locator("[data-sb-thread-row]")
          .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-sb-thread-row"))),
        order.map((key) => `${environmentId}:${project.threadId(key)}`),
      );
      // The URL changes before the route resolves; traversal starts from the
      // resolved route, which the row exposes as aria-current.
      const waitForCurrent = async (key: keyof typeof project.rows) => {
        await page!.waitForURL((url) => url.pathname.endsWith(`/${project.threadId(key)}`));
        await sidebar
          .locator(
            `[data-sb-thread-row="${environmentId}:${project.threadId(key)}"][aria-current="page"]`,
          )
          .waitFor();
      };
      const mod = await page.evaluate(() => (/Mac/.test(navigator.platform) ? "Meta" : "Control"));
      await row(order[0]).click();
      await waitForCurrent(order[0]);
      for (const key of order.slice(1)) {
        await page.keyboard.press(`${mod}+Shift+BracketRight`);
        await waitForCurrent(key);
      }
      for (const key of order.slice(0, -1).toReversed()) {
        await page.keyboard.press(`${mod}+Shift+BracketLeft`);
        await waitForCurrent(key);
      }
      // The browser reserves mod+1–9 by default; explicit user bindings exercise
      // the shared jump behavior without pretending to be an Electron client.
      for (const binding of jumpBindings) {
        await browserRpc(page, "server.upsertKeybinding", binding);
        installedBindings.push(binding);
      }
      await openBranchProject(page, project);
      await row("settled").waitFor();
      await page.keyboard.down(mod);
      try {
        for (const [index, key] of order.entries()) {
          await row(key)
            .getByText(new RegExp(`${index + 1}$`))
            .waitFor();
          await page.keyboard.press(`Digit${index + 1}`);
          await waitForCurrent(key);
        }
      } finally {
        await page.keyboard.up(mod);
      }
      await row("worktree").click();
      await row("alphaSecond").click({ modifiers: ["Shift"] });
      NodeAssert.deepEqual(
        await sidebar
          .locator('[data-sb-thread-row][aria-selected="true"]')
          .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-sb-thread-row"))),
        ["worktree", "beta", "alphaFirst", "alphaSecond"].map(
          (key) => `${environmentId}:${project.id}-${key}`,
        ),
      );
    } finally {
      if (page) {
        for (const binding of installedBindings) {
          await browserRpc(page, "server.removeKeybinding", binding);
        }
      }
      await context.close();
    }
  },
);

NodeTest.test(
  "branch drag reorders only its lane, rejects foreign branches, and keeps pin and settle actions",
  { timeout: 180_000 },
  async () => {
    const project = await seedBranchProject("qa-branch-drag", false);
    const context = await newContext({ switchboard: true });
    try {
      const page = await context.newPage();
      const writes = observeThreadWrites(page);
      const sidebar = await openBranchProject(page, project);
      const alphaLane = sidebar.getByRole("group", {
        name: "feature/alpha, 2 threads",
        exact: true,
      });
      await alphaLane.waitFor();
      const firstRow = alphaLane.getByRole("option", { name: optionName("Alpha first") });
      const scopedKey = await firstRow.getAttribute("data-sb-thread-row");
      NodeAssert.ok(scopedKey);
      NodeAssert.ok(scopedKey?.endsWith(`:${project.threadId("alphaFirst")}`));
      const environmentId = scopedKey.slice(0, -project.threadId("alphaFirst").length - 1);
      const row = (key: keyof typeof project.rows) =>
        sidebar.locator(`[data-sb-thread-row="${environmentId}:${project.threadId(key)}"]`);
      const fixtureThreads = (shell: OrchestrationShellSnapshot) =>
        shell.threads.filter((thread) => thread.projectId === project.id);
      const withoutActiveOrder = (shell: OrchestrationShellSnapshot) =>
        fixtureThreads(shell).map(({ activeOrderKey: _activeOrderKey, ...thread }) => thread);
      NodeAssert.equal(await sidebar.getByText("Drop to pin", { exact: true }).count(), 0);

      // Pickup mounts Drop to pin above every lane. Releasing without a
      // deliberate move must not pin or reorder whatever slid under the pointer.
      const beforePickup = await readShell();
      for (const key of ["worktree", "alphaSecond"] as const) {
        const held = await startRowDrag(page, row(key));
        await sidebar.getByText("Drop to pin", { exact: true }).waitFor();
        await page.mouse.move(held.x, held.y + 3);
        await page.mouse.up();
        await page.locator("[data-sb-drag-overlay]").waitFor({ state: "detached" });
      }
      NodeAssert.deepEqual(await readShell(), beforePickup, "A held pickup must persist no event");
      NodeAssert.equal(writes.commands.length, 0, "A held pickup must send no command");

      const beforeReorder = await readShell();
      const reordered = writes.next("thread.active.reorder");
      await startRowDrag(page, row("alphaSecond"));
      // Over its own slot the chip names no verb.
      NodeAssert.equal(await page.locator("[data-sb-drag-overlay] [data-sb-drag-verb]").count(), 0);
      await moveDragTo(page, row("alphaFirst"), 0.2);
      // Release only once the drop targets the row, not the pickup slot.
      await dropIndicatorOn(row("alphaFirst")).waitFor();
      await page.locator("[data-sb-drag-overlay]").getByText("Move", { exact: true }).waitFor();
      await page.mouse.up();
      await reordered;
      await page.locator("[data-sb-drag-overlay]").waitFor({ state: "detached" });
      NodeAssert.deepEqual(
        await alphaLane
          .getByRole("option")
          .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-sb-thread-row"))),
        (["alphaSecond", "alphaFirst"] as const).map(
          (key) => `${environmentId}:${project.threadId(key)}`,
        ),
      );
      const afterReorder = await readShell();
      NodeAssert.deepEqual(withoutActiveOrder(afterReorder), withoutActiveOrder(beforeReorder));
      NodeAssert.ok(
        fixtureThreads(afterReorder).some(
          (thread) =>
            thread.activeOrderKey !==
            fixtureThreads(beforeReorder).find((before) => before.id === thread.id)?.activeOrderKey,
        ),
      );
      NodeAssert.deepEqual(
        writes.commands.map((command) => command.type),
        ["thread.active.reorder"],
      );

      const beforeReject = await readShell();
      const writeCount = writes.commands.length;
      await startRowDrag(page, row("alphaSecond"));
      const pointer = await moveDragTo(page, row("beta"));
      await sidebar.locator("[data-sb-drop-rejected]").waitFor();
      await page
        .getByRole("tooltip", { name: "Branch comes from the thread's worktree", exact: true })
        .waitFor();
      // A drag hides the hovered row's quick actions; its age stays visible.
      NodeAssert.equal(await row("beta").locator(".sb-row-actions").isVisible(), false);
      NodeAssert.equal(
        await page.evaluate(({ x, y }) => {
          const target = document.elementFromPoint(x, y);
          return target ? getComputedStyle(target).cursor : null;
        }, pointer),
        "not-allowed",
      );
      await page.mouse.up();
      await page.locator("[data-sb-drag-overlay]").waitFor({ state: "detached" });
      NodeAssert.deepEqual(
        await readShell(),
        beforeReject,
        "A cross-lane drop must persist no event",
      );
      NodeAssert.equal(
        writes.commands.length,
        writeCount,
        "A cross-lane drop must send no command",
      );

      const pinned = writes.next("thread.pin");
      await startRowDrag(page, row("alphaFirst"));
      const pinTarget = sidebar.getByText("Drop to pin", { exact: true });
      await pinTarget.waitFor();
      await moveDragTo(page, pinTarget);
      const overlay = page.locator("[data-sb-drag-overlay]");
      await overlay.getByText("Pin", { exact: true }).waitFor();
      const overlayBox = await overlay.boundingBox();
      NodeAssert.ok(overlayBox && overlayBox.height <= 40, "Drag overlay must stay a compact chip");
      await page.mouse.up();
      await pinned;
      await sidebar
        .getByRole("group", { name: "Pinned, 1 thread", exact: true })
        .getByRole("option", { name: optionName("Alpha first") })
        .waitFor();
      NodeAssert.equal(await sidebar.getByText("Drop to pin", { exact: true }).count(), 0);
      const pinnedThread = fixtureThreads(await readShell()).find(
        (thread) => thread.id === project.threadId("alphaFirst"),
      );
      NodeAssert.ok(pinnedThread?.pinnedAt);
      NodeAssert.equal(pinnedThread.branch, "feature/alpha");

      // A snoozed row over its own lane wakes; the chip and the live region say so.
      await sidebar.getByTestId("sidebar-snoozed-shelf-toggle").click();
      await row("snoozed").waitFor();
      const writesBeforeWake = writes.commands.length;
      await startRowDrag(page, row("snoozed"));
      await moveDragTo(page, row("beta"));
      await overlay.getByText("Wake", { exact: true }).waitFor();
      await dndAnnouncement(page, "Wake thread").waitFor({ state: "attached" });
      // Back over its own slot: no verb, and releasing there writes nothing.
      await moveDragTo(page, row("snoozed"));
      await overlay.locator("[data-sb-drag-verb]").waitFor({ state: "detached" });
      await page.mouse.up();
      await overlay.waitFor({ state: "detached" });
      NodeAssert.equal(writes.commands.length, writesBeforeWake);
      await sidebar.getByTestId("sidebar-snoozed-shelf-toggle").click();
      await row("snoozed").waitFor({ state: "detached" });

      const settled = writes.next("thread.settle");
      await startRowDrag(page, row("beta"));
      await moveDragTo(page, sidebar.getByTestId("sidebar-settled-header"), 0.5, true);
      await overlay.getByText("Settle", { exact: true }).waitFor();
      await page.mouse.up();
      await settled;
      await sidebar.getByTestId("sidebar-settled-shelf-toggle").click();
      await row("beta").waitFor();
      NodeAssert.equal(
        fixtureThreads(await readShell()).find((thread) => thread.id === project.threadId("beta"))
          ?.settledOverride,
        "settled",
      );

      // Existing keyboard lifecycle actions still operate on the selected row.
      // They act on the open thread, so wait for its view before pressing.
      const openThread = async (key: keyof typeof project.rows) => {
        await row(key).click();
        await sidebar
          .locator(
            `[data-sb-thread-row="${environmentId}:${project.threadId(key)}"][aria-current="page"]`,
          )
          .waitFor();
        await page.getByRole("heading", { name: project.rows[key].title, exact: true }).waitFor();
      };
      const mod = await page.evaluate(() => (/Mac/.test(navigator.platform) ? "Meta" : "Control"));
      await openThread("alphaSecond");
      const keyboardPin = writes.next("thread.pin");
      await page.keyboard.press(`${mod}+Shift+KeyP`);
      await keyboardPin;
      await sidebar.getByRole("group", { name: "Pinned, 2 threads", exact: true }).waitFor();
      const pinReordered = writes.next("thread.pin.reorder");
      await startRowDrag(page, row("alphaSecond"));
      await moveDragTo(page, row("alphaFirst"), 0.8);
      await dropIndicatorOn(row("alphaFirst")).waitFor();
      await page.mouse.up();
      await pinReordered;
      const pinOrder = await sidebar
        .getByRole("group", { name: "Pinned, 2 threads", exact: true })
        .getByRole("option")
        .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-sb-thread-row")));
      NodeAssert.deepEqual(
        pinOrder,
        (["alphaFirst", "alphaSecond"] as const).map(
          (key) => `${environmentId}:${project.threadId(key)}`,
        ),
      );

      await openThread("alphaSecond");
      const keyboardSettle = writes.next("thread.settle");
      await page.keyboard.press(`${mod}+Shift+KeyS`);
      await keyboardSettle;
      NodeAssert.equal(
        fixtureThreads(await readShell()).find(
          (thread) => thread.id === project.threadId("alphaSecond"),
        )?.settledOverride,
        "settled",
      );
      const undoSettle = writes.next("thread.unsettle");
      const undoPin = writes.next("thread.pin");
      await page.keyboard.press(`${mod}+KeyZ`);
      await Promise.all([undoSettle, undoPin]);
      await row("alphaSecond").waitFor();
      NodeAssert.equal(
        fixtureThreads(await readShell()).find(
          (thread) => thread.id === project.threadId("alphaSecond"),
        )?.settledOverride,
        "active",
      );

      await sidebar.getByTestId("sidebar-snoozed-shelf-toggle").click();
      await row("snoozed").waitFor();
      // The Snoozed shelf is never a target, and never reads as another branch.
      const writesBeforeShelfHover = writes.commands.length;
      await startRowDrag(page, row("worktree"));
      await moveDragTo(page, row("snoozed"), 0.5, true);
      // The live region confirms a non-target; a misread lane would announce "Can't move to …".
      await dndAnnouncement(page, "Cannot drop here").waitFor({ state: "attached" });
      NodeAssert.equal(await overlay.locator("[data-sb-drag-verb]").count(), 0);
      NodeAssert.equal(await sidebar.locator("[data-sb-drop-rejected]").count(), 0);
      await page.mouse.up();
      await overlay.waitFor({ state: "detached" });
      NodeAssert.equal(writes.commands.length, writesBeforeShelfHover);

      const wakePinned = writes.next("thread.pin");
      await startRowDrag(page, row("snoozed"));
      await moveDragTo(
        page,
        sidebar.getByRole("group", { name: "Pinned, 2 threads", exact: true }),
        0.15,
      );
      await overlay.getByText("Pin", { exact: true }).waitFor();
      await page.mouse.up();
      await wakePinned;
      await sidebar
        .getByRole("group", { name: "Pinned, 3 threads", exact: true })
        .getByRole("option", { name: optionName("Snoozed thread") })
        .waitFor();
      const wokenThread = fixtureThreads(await readShell()).find(
        (thread) => thread.id === project.threadId("snoozed"),
      );
      NodeAssert.equal(wokenThread?.snoozedUntil, null);
      NodeAssert.ok(wokenThread?.pinnedAt);

      // With three pins, the Pinned lane itself must not outbid its middle row.
      const pinnedLane = sidebar.getByRole("group", { name: "Pinned, 3 threads", exact: true });
      const pinnedOrder = () =>
        pinnedLane
          .getByRole("option")
          .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-sb-thread-row")));
      const [firstPin, secondPin, thirdPin] = await pinnedOrder();
      NodeAssert.ok(firstPin && secondPin && thirdPin);
      const middleReordered = writes.next("thread.pin.reorder");
      await overlay.waitFor({ state: "detached" });
      await startRowDrag(page, pinnedLane.locator(`[data-sb-thread-row="${thirdPin}"]`));
      const middlePin = pinnedLane.locator(`[data-sb-thread-row="${secondPin}"]`);
      await moveDragTo(page, middlePin);
      await dropIndicatorOn(middlePin).waitFor();
      await page.mouse.up();
      await middleReordered;
      await overlay.waitFor({ state: "detached" });
      NodeAssert.deepEqual(await pinnedOrder(), [firstPin, thirdPin, secondPin]);
    } finally {
      await context.close();
    }
  },
);

async function rootCustomProperties(context: BrowserContext, url: string) {
  const page = await context.newPage();
  try {
    await page.clock.setFixedTime(new Date(fixedTime));
    await page.goto(`${url}/`);
    await page.getByText("Flags-off parity", { exact: true }).first().waitFor({
      state: "visible",
      timeout: 60_000,
    });
    return await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      const vars: Record<string, string> = {};
      for (let index = 0; index < styles.length; index += 1) {
        const name = styles.item(index);
        if (name.startsWith("--")) vars[name] = styles.getPropertyValue(name).trim();
      }
      return vars;
    });
  } finally {
    await page.close();
  }
}

NodeTest.test(
  "flags-off sidebar and settings snapshots are pixel-identical to PR base",
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
          `${surface} flags-off screenshot differs from the PR base; inspect ${artifacts}`,
        );
      }
      const [baseVars, currentVars] = await Promise.all([
        rootCustomProperties(context, mainUrl),
        rootCustomProperties(context, currentUrl),
      ]);
      const names = new Set([...Object.keys(baseVars), ...Object.keys(currentVars)]);
      const added = [...names].filter((name) => !(name in baseVars)).sort();
      const removed = [...names].filter((name) => !(name in currentVars)).sort();
      const changed = [...names]
        .filter(
          (name) => name in baseVars && name in currentVars && baseVars[name] !== currentVars[name],
        )
        .sort();
      await NodeFSP.writeFile(
        NodePath.join(artifacts, "flags-off-root-vars.json"),
        JSON.stringify(
          {
            baseCount: Object.keys(baseVars).length,
            currentCount: Object.keys(currentVars).length,
            added,
            removed,
            changed,
          },
          null,
          2,
        ),
      );
      NodeAssert.deepEqual({ added, removed, changed }, { added: [], removed: [], changed: [] });

      await NodeFSP.writeFile(
        NodePath.join(sandbox, "project", "README.md"),
        "# Flags-off preview\n",
      );
      const preview = await context.newPage();
      await preview.clock.setFixedTime(new Date(fixedTime));
      await preview.setViewportSize({ width: 1440, height: 900 });
      await preview.goto(`${currentUrl}/`);
      await preview
        .locator('[data-testid="sidebar-row-card"]', { hasText: "Flags-off parity" })
        .click();
      try {
        await preview.waitForFunction(() => location.pathname.includes("/qa-thread"));
      } catch (error) {
        throw new Error(`Thread row stayed at ${preview.url()}`, { cause: error });
      }
      const opened = await preview.evaluate(async () => {
        const match = location.pathname.match(/\/([^/]+)\/qa-thread$/);
        if (!match?.[1]) return false;
        const specifier = "/src/rightPanelStore.ts";
        const store = (await import(specifier)) as {
          useRightPanelStore: {
            getState: () => {
              openFile: (ref: { environmentId: string; threadId: string }, path: string) => void;
            };
          };
        };
        store.useRightPanelStore
          .getState()
          .openFile({ environmentId: match[1], threadId: "qa-thread" }, "README.md");
        return true;
      });
      NodeAssert.equal(opened, true);
      await preview.getByRole("button", { name: "Open file in preferred editor" }).waitFor();
      await preview.screenshot({
        path: NodePath.join(artifacts, "flags-off-file-preview.png"),
        animations: "disabled",
      });
      await preview.close();
    } finally {
      await context.close();
    }
  },
);

NodeTest.test("mobile project strip scrolls inside the page", { timeout: 180_000 }, async () => {
  const stripProjects = [
    ["strip-1", "Strip One"],
    ["strip-2", "Strip Two"],
    ["strip-3", "Strip Three"],
    ["strip-4", "Strip Four"],
    ["strip-5", "Strip Five"],
  ] as const;
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
  for (const [id, title] of stripProjects) {
    const root = NodePath.join(sandbox, id);
    await NodeFSP.mkdir(root, { recursive: true });
    await exec("git", ["init", "--quiet", root]);
    await dispatch({
      type: "project.create",
      commandId: `qa-${id}-create`,
      projectId: id,
      title,
      workspaceRoot: root,
      createdAt: fixedTime,
    });
  }

  const context = await newContext({ switchboard: true });
  try {
    const mobile = await context.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.clock.setFixedTime(new Date(fixedTime));
    await mobile.goto(`${currentUrl}/`);
    await mobile.getByRole("button", { name: "Toggle main sidebar" }).click();
    const strip = mobile.getByRole("navigation", { name: "Projects" });
    const owned: Array<Locator> = [];
    for (const [, title] of stripProjects) {
      const button = strip.getByRole("button", { name: title, exact: true });
      await button.waitFor();
      owned.push(button);
    }
    NodeAssert.equal(owned.length, stripProjects.length);
    NodeAssert.equal(await strip.evaluate((node) => getComputedStyle(node).scrollbarWidth), "none");
    const pageBox = await mobile.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    NodeAssert.ok(
      pageBox.scrollWidth <= pageBox.clientWidth,
      `The page overflows horizontally: ${JSON.stringify(pageBox)}`,
    );
    let last = owned[0];
    NodeAssert.ok(last);
    let lastRight = Number.NEGATIVE_INFINITY;
    for (const button of owned) {
      const box = await button.boundingBox();
      NodeAssert.ok(box);
      const right = box.x + box.width;
      if (right >= lastRight) {
        lastRight = right;
        last = button;
      }
    }
    await last.scrollIntoViewIfNeeded();
    const [lastBox, stripBox] = await Promise.all([last.boundingBox(), strip.boundingBox()]);
    NodeAssert.ok(lastBox && stripBox);
    NodeAssert.ok(
      lastBox.x >= stripBox.x - 1 && lastBox.x + lastBox.width <= stripBox.x + stripBox.width + 1,
      `The last project is outside the strip: ${JSON.stringify({ lastBox, stripBox })}`,
    );
    await mobile.screenshot({
      path: NodePath.join(artifacts, "flag-on-mobile-strip-5.png"),
      animations: "disabled",
    });
    await mobile.close();
  } finally {
    await context.close();
  }
});
