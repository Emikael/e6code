// @effect-diagnostics nodeBuiltinImport:off - launches the real browser/server outside an Effect runtime.
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
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

async function newContext(options?: {
  readonly switchboard?: boolean;
  readonly colorScheme?: "light" | "dark";
  readonly snoozedShelfExpanded?: boolean;
  /** Extra persisted UI state, merged into the seeded ui-state blob. */
  readonly uiState?: Record<string, unknown>;
}): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: options?.colorScheme ?? "dark",
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
    ({ time, switchboard, snoozedShelfExpanded, uiState }) => {
      // A reload keeps what the page persisted; every other load starts seeded.
      const navigation = performance.getEntriesByType("navigation")[0];
      if (navigation instanceof PerformanceNavigationTiming && navigation.type === "reload") return;
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
          ...uiState,
        }),
      );
      if (snoozedShelfExpanded) localStorage.setItem("e6code:sidebar:snoozed-expanded", "true");
    },
    {
      time: fixedTime,
      switchboard: options?.switchboard === true,
      snoozedShelfExpanded: options?.snoozedShelfExpanded === true,
      uiState: options?.uiState ?? {},
    },
  );
  return context;
}

/** Rewrites thread shells on the app socket, for states the dispatch endpoint
 * cannot create (pending approvals, sessions, synced pull requests). Every
 * object carrying a patched thread's id, project and title gets the fields. */
async function patchThreadShells(
  context: BrowserContext,
  patches: Readonly<Record<string, Record<string, unknown>>>,
) {
  const patch = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) patch(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const fields = typeof record.id === "string" ? patches[record.id] : undefined;
    if (fields && "projectId" in record && "title" in record) Object.assign(record, fields);
    for (const child of Object.values(record)) patch(child);
  };
  // The shell snapshot loads over HTTP; later changes stream over the socket.
  await context.route(
    (url) => url.pathname === "/api/orchestration/shell",
    async (route) => {
      const response = await route.fetch();
      const body: unknown = await response.json();
      patch(body);
      await route.fulfill({ response, json: body });
    },
  );
  await context.routeWebSocket(
    (url) => url.pathname === "/ws",
    (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => server.send(message));
      server.onMessage((message) => {
        if (typeof message !== "string") return socket.send(message);
        const parsed: unknown = JSON.parse(message);
        patch(parsed);
        socket.send(JSON.stringify(parsed));
      });
    },
  );
}

function qaSession(threadId: string, status: "running" | "error") {
  return {
    threadId,
    status,
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: status === "running" ? "qa-turn" : null,
    lastError: status === "error" ? "Provider exited" : null,
    updatedAt: fixedTime,
  };
}

function qaPullRequest(
  number: number,
  state: "open" | "merged" | "closed",
  updatedAt: string,
  isDraft = false,
) {
  return {
    host: "github.com",
    repository: "acme/app",
    number,
    url: `https://github.com/acme/app/pull/${number}`,
    source: "created",
    linkedAt: fixedTime,
    snapshot: {
      state,
      title: `QA pull request ${number}`,
      headBranch: "feature/qa",
      baseBranch: "main",
      isDraft,
      updatedAt,
      syncedAt: updatedAt,
    },
    stack: null,
  };
}

type PersistedSwitchboardState = {
  sidebarGroupBy?: string;
  sidebarDensity?: string;
  sidebarLaneCollapsed?: Record<string, boolean>;
};

/** All projects scope. The index route drops into a draft, which remounts the
 * chat view, so wait for that before driving the sidebar. */
async function openAllProjects(page: Page) {
  await page.goto(`${currentUrl}/`);
  await page.waitForURL((url) => url.pathname.startsWith("/draft/"));
  await page.getByRole("heading", { name: "All projects" }).waitFor();
}

async function readUiState(page: Page): Promise<PersistedSwitchboardState> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("e6code:ui-state:v1") ?? "{}"));
}

/** The store persists on a short debounce; wait until `path` holds `value`. */
async function waitForPersisted(page: Page, path: readonly string[], value: unknown) {
  await page.waitForFunction(
    ({ path, value }) => {
      let node: unknown = JSON.parse(localStorage.getItem("e6code:ui-state:v1") ?? "{}");
      for (const key of path) node = (node as Record<string, unknown> | undefined)?.[key];
      return node === value;
    },
    { path, value },
    { timeout: 10_000 },
  );
}

/** Picks a Group by mode from the switchboard header menu. */
async function chooseGroupBy(page: Page, sidebar: Locator, label: "Branch" | "Status" | "Project") {
  // A closing popup can still be mounted; never aim at its items.
  const menu = page.getByRole("menu");
  await menu.waitFor({ state: "detached" });
  await sidebar.getByRole("button", { name: /^Group by / }).click();
  await menu.getByRole("menuitemradio", { name: new RegExp(`^${label}`) }).click();
  await menu.waitFor({ state: "detached" });
  await sidebar.getByRole("button", { name: `Group by ${label}`, exact: true }).waitFor();
}

/** Scope the sidebar from the project rail, without a page load. */
async function scopeFromRail(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Projects" })
    .getByRole("button", { name: new RegExp(`^${name}(,|$)`) })
    .click();
  await page.getByRole("heading", { name, exact: true }).waitFor();
}

/** Whether the element's box lies inside the viewport and every scrolling ancestor. */
async function onScreen(locator: Locator): Promise<boolean> {
  return locator.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const inside = (outer: { top: number; bottom: number; left: number; right: number }) =>
      box.top >= outer.top - 1 &&
      box.bottom <= outer.bottom + 1 &&
      box.left >= outer.left - 1 &&
      box.right <= outer.right + 1;
    if (box.width === 0 || box.height === 0) return false;
    if (!inside({ top: 0, left: 0, bottom: innerHeight, right: innerWidth })) return false;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const { overflowY } = getComputedStyle(parent);
      const scrolls = overflowY === "auto" || overflowY === "scroll";
      if (scrolls && !inside(parent.getBoundingClientRect())) return false;
    }
    return true;
  });
}

/** Lets pending effects and the renders they cause land: two animation frames. */
async function afterRenders(page: Page) {
  for (let frame = 0; frame < 2; frame += 1) {
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
  }
}

/** An in-app navigation that the sidebar did not start, like a notification's. */
async function navigateFromOutside(page: Page, pathname: string) {
  await page.evaluate((path) => {
    history.pushState(null, "", path);
    dispatchEvent(new PopStateEvent("popstate"));
  }, pathname);
  await page.waitForURL((url) => url.pathname === pathname);
}

/** Which sides of `target` show the focus ring's colour within 6px of the
 * edge, read from a real screenshot, so a ring covered by a positioned fill
 * counts as missing. The left side is sampled at the lane glyph's height too. */
async function focusRingSides(page: Page, target: Locator) {
  const box = await target.boundingBox();
  NodeAssert.ok(box);
  const pad = 6;
  const clip = {
    x: Math.floor(box.x) - pad,
    y: Math.floor(box.y) - pad,
    width: Math.ceil(box.width) + pad * 2,
    height: Math.ceil(box.height) + pad * 2,
  };
  const png = await page.screenshot({ clip, animations: "disabled", caret: "hide" });
  return page.evaluate(
    async ({ data, box, clip, pad }) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--ring)";
      document.querySelector('[data-switchboard="sidebar"]')!.append(probe);
      const swatch = document.createElement("canvas").getContext("2d")!;
      swatch.fillStyle = getComputedStyle(probe).color;
      probe.remove();
      swatch.fillRect(0, 0, 1, 1);
      const ring = swatch.getImageData(0, 0, 1, 1).data;
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      const isRing = (x: number, y: number) => {
        const index = (y * image.width + x) * 4;
        return (
          Math.hypot(
            pixels[index]! - ring[0]!,
            pixels[index + 1]! - ring[1]!,
            pixels[index + 2]! - ring[2]!,
          ) < 40
        );
      };
      const left = Math.round(box.x - clip.x);
      const top = Math.round(box.y - clip.y);
      const right = left + Math.round(box.width) - 1;
      const bottom = top + Math.round(box.height) - 1;
      const midX = Math.round((left + right) / 2);
      const midY = Math.round((top + bottom) / 2);
      const band = (edge: number) =>
        Array.from({ length: pad * 2 }, (_, step) => edge - pad + step);
      const across = (y: number, edge: number) => band(edge).some((x) => isRing(x, y));
      const down = (x: number, edge: number) => band(edge).some((y) => isRing(x, y));
      return {
        top: down(midX, top),
        bottom: down(midX, bottom),
        left: across(midY, left) && across(top + 14, left),
        right: across(midY, right),
      };
    },
    { data: png.toString("base64"), box, clip, pad },
  );
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
      // If the runner exits before teardown finishes, the backend goes with it.
      const spawned = backend;
      process.once("exit", () => spawned.kill("SIGKILL"));
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
      await dispatchFixture({
        type: "project.create",
        commandId: "qa-project-create",
        projectId: "qa-project",
        title: "Switchboard QA",
        workspaceRoot: workspace,
        createdAt: fixedTime,
      });
      await dispatchFixture({
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
      // Flags-off parity also covers a snoozed row and its wake countdown.
      await dispatchFixture({
        type: "thread.create",
        commandId: "qa-snoozed-thread-create",
        threadId: "qa-snoozed-thread",
        projectId: "qa-project",
        title: "Flags-off snoozed",
        modelSelection: { instanceId: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: fixedTime,
      });
      await dispatchFixture({
        type: "thread.snooze",
        commandId: "qa-snoozed-thread-snooze",
        threadId: "qa-snoozed-thread",
        snoozedUntil: "2099-01-01T00:00:00.000Z",
      });
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      await browser?.close().catch(() => {});
      await Promise.all(frontends.map((server) => server.close().catch(() => {})));
      frontends.length = 0;
      await stopBackend();
      if (sandbox) await NodeFSP.rm(sandbox, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  },
  { timeout: 180_000 },
);

/** Stops the backend this suite spawned, by its handle, without ever waiting on it forever. */
async function stopBackend() {
  const child = backend;
  backend = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  child.kill("SIGTERM");
  const escalate = setTimeout(() => child.kill("SIGKILL"), 10_000);
  await exited;
  clearTimeout(escalate);
}

NodeTest.after(async () => {
  // Every step runs even when an earlier one fails, so a broken browser or
  // dev server can't leave the backend running and the suite waiting on it.
  const results = await Promise.allSettled([
    browser?.close(),
    ...frontends.map((server) => server.close()),
    stopBackend(),
  ]);
  await backendLogWrite;
  if (sandbox) await NodeFSP.rm(sandbox, { recursive: true, force: true });
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
  }
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
      await page.locator('select[aria-label="Group by"]').selectOption("status");
      await page.locator('select[aria-label="Density"]').selectOption("compact");
      await page
        .getByRole("button", { name: "feature/switchboard worktree 3 threads", exact: true })
        .click();
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
    if (surface === "sidebar") {
      // The snoozed shelf is expanded, so its row and wake countdown are captured too.
      // Shelf rows use content-visibility:auto, so a row below the fold may not be
      // painted yet. Both builds scroll it into view before the capture.
      const snoozedRow = page.getByText("Flags-off snoozed", { exact: true });
      await snoozedRow.waitFor({ state: "attached", timeout: 60_000 });
      await snoozedRow.scrollIntoViewIfNeeded({ timeout: 60_000 });
      await snoozedRow.waitFor({ state: "visible", timeout: 60_000 });
      NodeAssert.ok(await onScreen(snoozedRow), "The snoozed row is not on screen for the capture");
    }
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

/** Calls the test backend: a GET, or a JSON POST when given a body. Every
 * call opens its own connection. Reusing an idle pooled socket races the
 * server closing it, and a POST that lost that race cannot be resent: it may
 * have reached the server and would double-apply. */
function backendRequest(path: string, body?: object): Promise<Response> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = NodeHttp.request(
      {
        host: "127.0.0.1",
        port: backendPort,
        path,
        method: payload === undefined ? "GET" : "POST",
        agent: false,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload === undefined
            ? {}
            : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () =>
          resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 500 })),
        );
      },
    );
    request.on("error", reject);
    request.end(payload);
  });
}

async function dispatchFixture(command: object) {
  const response = await backendRequest("/api/orchestration/dispatch", command);
  NodeAssert.equal(response.status, 200, await response.text());
}

async function readShell(): Promise<OrchestrationShellSnapshot> {
  const response = await backendRequest("/api/orchestration/shell");
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
function dndAnnouncement(page: Page, text: string | RegExp) {
  return page.locator('[id^="DndLiveRegion"]').filter({ hasText: text });
}

/** The drop indicator sits beside the row element, inside the row's list item. */
function dropIndicatorOn(row: Locator) {
  return row.locator("xpath=..").locator(":scope > [data-sb-drop-indicator]");
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
  options?: {
    /** Playwright's fake clock replaces `performance`, so a page that must
     * tell a reload from a fresh load runs on the real clock. */
    readonly realClock?: boolean;
  },
) {
  if (options?.realClock !== true) await page.clock.setFixedTime(new Date(fixedTime));
  await page.goto(`${currentUrl}/`);
  try {
    await page
      .getByRole("navigation", { name: "Projects" })
      // The rail appends live state to the name, e.g. "…, 1 need you".
      .getByRole("button", { name: new RegExp(`^${project.title}(,|$)`) })
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

/** Critical and serious axe violations inside every `selector` match, as readable lines. */
async function seriousAxeViolations(page: Page, selector: string): Promise<string[]> {
  await page.addScriptTag({
    path: NodeURL.fileURLToPath(import.meta.resolve("axe-core/axe.min.js")),
  });
  const violations = await page.evaluate(async (scope) => {
    const { axe } = window as unknown as {
      axe: { run: (context: object, options: object) => Promise<AxeResults> };
    };
    if (!document.querySelector(scope)) throw new Error(`No axe scope ${scope}`);
    const result = await axe.run({ include: [[scope]] }, { resultTypes: ["violations"] });
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

/** ENG-29: lane and section headers sit inside the Threads listbox's groups,
 * which axe reports as aria-required-children until the list moves to a
 * tree or grid pattern. Only that finding is set aside; the caller reports
 * how many there were. */
function isThreadListboxStructureFinding(violation: string): boolean {
  return / aria-required-children <ul role="listbox" aria-label="Threads"/.test(violation);
}

/** The accessible name and description Chromium computes for the first `selector` match. */
async function accessibleText(page: Page, selector: string) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    const { nodes } = await cdp.send("Accessibility.getPartialAXTree", {
      nodeId,
      fetchRelatives: false,
    });
    return {
      name: String(nodes[0]?.name?.value ?? ""),
      description: String(nodes[0]?.description?.value ?? ""),
    };
  } finally {
    await cdp.detach();
  }
}

NodeTest.test(
  "branch lanes have no critical or serious axe violations at rest, on hover, focus and selection, or mid-drag",
  { timeout: 300_000 },
  async () => {
    const project = await seedBranchProject("qa-branch-a11y");
    const scope = '[data-switchboard="sidebar"]';
    const violations: string[] = [];
    const listboxFindings: string[] = [];
    for (const colorScheme of ["dark", "light"] as const) {
      const context = await newContext({ switchboard: true, colorScheme });
      try {
        const page = await context.newPage();
        const blockedAriaHidden: string[] = [];
        page.on("console", (message) => {
          if (message.text().includes("aria-hidden")) blockedAriaHidden.push(message.text());
        });
        const sidebar = await openBranchProject(page, project);
        NodeAssert.equal(
          await page.evaluate(() => document.documentElement.classList.contains("dark")),
          colorScheme === "dark",
        );
        await sidebar.getByRole("group", { name: "Pinned, 2 threads", exact: true }).waitFor();
        await sidebar.getByTestId("sidebar-snoozed-shelf-toggle").click();
        await sidebar.getByTestId("sidebar-settled-shelf-toggle").click();
        // Rows are named by their title; status and details are the description.
        const option = sidebar.getByRole("option", { name: "Alpha first", exact: true });
        const snoozedRow = sidebar.getByRole("button", { name: "Snoozed thread", exact: true });
        const settledRow = sidebar.getByRole("button", { name: "Settled thread", exact: true });
        await settledRow.waitFor();
        const rowSelector = async (row: Locator) =>
          `[data-sb-thread-row="${await row.getAttribute("data-sb-thread-row")}"]`;
        const optionText = await accessibleText(page, await rowSelector(option));
        NodeAssert.equal(optionText.name, "Alpha first");
        NodeAssert.match(optionText.description, /^Ready\. Codex: \S/);
        NodeAssert.deepEqual(await accessibleText(page, await rowSelector(snoozedRow)), {
          name: "Snoozed thread",
          description: `Ready. Wakes in ${Math.ceil((Date.parse("2099-01-01T00:00:00.000Z") - Date.parse(fixedTime)) / 86_400_000)}d`,
        });
        NodeAssert.deepEqual(await accessibleText(page, await rowSelector(settledRow)), {
          name: "Settled thread",
          description: "Ready",
        });

        const audit = async (state: string) => {
          for (const violation of await seriousAxeViolations(page, scope)) {
            if (isThreadListboxStructureFinding(violation)) {
              listboxFindings.push(`${colorScheme} ${state}`);
              continue;
            }
            violations.push(`${colorScheme} ${state}: ${violation}`);
          }
        };
        const away = () => page.mouse.move(1000, 450);
        await away();
        await audit("rest");
        for (const [kind, row] of [
          ["option", option],
          ["shelf row", settledRow],
        ] as const) {
          await row.hover();
          await row.locator("xpath=..").locator("button[tabindex='-1']").first().waitFor();
          await audit(`${kind} hover`);
          await away();
          await row.focus();
          if (kind === "shelf row") {
            // Keyboard focus shows the shelf action over the age, as hover does.
            await page.waitForFunction(
              ([action, age]) =>
                getComputedStyle(action!).opacity === "1" && getComputedStyle(age!).opacity === "0",
              [
                await row
                  .locator("xpath=..")
                  .getByRole("button", { name: "Un-settle thread" })
                  .elementHandle(),
                await row.locator("span.tabular-nums.text-secondary-label").first().elementHandle(),
              ],
              { timeout: 5_000 },
            );
          }
          await audit(`${kind} focus`);
          await row.click();
          await row.and(sidebar.locator('[aria-current="page"]')).waitFor();
          await audit(`${kind} selected`);
          await away();
        }
        // WCAG 2.4.7: [content-visibility:auto] on the shelf <li> clips an
        // outset ring at the row's own box, so the ring must paint inset.
        for (const [label, row] of [
          ["settled", settledRow],
          ["snoozed", snoozedRow],
        ] as const) {
          // Chromium's focus-visible heuristic tracks keyboard-vs-pointer input
          // modality for the whole page, not per element; a real keyboard event
          // (discarded here) puts it back in "keyboard" mode before this focus.
          await page.keyboard.press("Tab");
          await row.focus();
          const li = row.locator("xpath=..");
          const focusState = await row.evaluate((node) => {
            const style = getComputedStyle(node);
            return {
              focusVisible: node.matches(":focus-visible"),
              outlineOffset: style.outlineOffset,
              outlineStyle: style.outlineStyle,
              outlineWidth: style.outlineWidth,
            };
          });
          NodeAssert.deepEqual(focusState, {
            focusVisible: true,
            outlineOffset: "-2px",
            outlineStyle: "solid",
            outlineWidth: "2px",
          });
          const [rowBox, liBox] = await Promise.all([row.boundingBox(), li.boundingBox()]);
          NodeAssert.ok(rowBox && liBox);
          NodeAssert.ok(
            rowBox.x >= liBox.x &&
              rowBox.y >= liBox.y &&
              rowBox.x + rowBox.width <= liBox.x + liBox.width &&
              rowBox.y + rowBox.height <= liBox.y + liBox.height,
            `${label} row escapes its <li>, so an inset focus ring would be clipped: ${JSON.stringify({ rowBox, liBox })}`,
          );
          await li.screenshot({
            path: NodePath.join(artifacts, `shelf-focus-${label}-${colorScheme}.png`),
            animations: "disabled",
          });
          await away();
        }
        // The hidden row actions are pointer shortcuts; using one must not
        // leave focus inside them, or Chrome stops honouring aria-hidden.
        await option.hover();
        const snooze = option.locator("xpath=..").locator('button[aria-label="Snooze thread"]');
        await snooze.click();
        // A generic role=dialog lookup also matches an unrelated toast (e.g. a
        // provider update advisory) that can appear once the backend has been
        // up long enough; the popover primitive's own slot stays unambiguous.
        const snoozeMenu = page.locator('[data-slot="popover-popup"]');
        await snoozeMenu.waitFor();
        await page.keyboard.press("Escape");
        await snoozeMenu.waitFor({ state: "detached" });
        // Closing hands focus back to the row option, not the hidden trigger.
        await page.waitForFunction(
          (row) => row === document.activeElement,
          await option.elementHandle(),
        );
        await away();
        await audit("option after its snooze menu");
        NodeAssert.deepEqual(blockedAriaHidden, []);
        await startRowDrag(
          page,
          sidebar.getByRole("option", { name: "Alpha second", exact: true }),
        );
        await moveDragTo(page, sidebar.getByRole("option", { name: "Beta thread", exact: true }));
        await sidebar.locator("[data-sb-drop-rejected]").waitFor();
        await page.locator('[data-sb-drag-verb="Can\'t move here"]').waitFor();
        await audit("drag reject");
        await page.mouse.up();
        // A pointer dismiss leaves focus where the pointer put it: clicking the
        // composer to close the menu must not pull focus back to the row.
        await option.hover();
        await snooze.click();
        await snoozeMenu.waitFor();
        const composer = page.getByTestId("composer-editor");
        await composer.click();
        await snoozeMenu.waitFor({ state: "detached" });
        // A late focus-restore (e.g. an unmount effect firing after the menu
        // has already detached) would otherwise land outside this window.
        await page.waitForTimeout(500);
        NodeAssert.ok(
          await composer.evaluate((editor) => editor.contains(document.activeElement)),
          "focus left the composer after the snooze menu closed",
        );
        await page.keyboard.type("Typed after closing");
        NodeAssert.match(await composer.innerText(), /Typed after closing/);
      } finally {
        await context.close();
      }
    }
    // A mouse Un-settle/Wake moves the row into the active lane, remounting
    // it elsewhere in the list; focus must follow to that new element.
    {
      const context = await newContext({ switchboard: true });
      try {
        const page = await context.newPage();
        const sidebar = await openBranchProject(page, project);
        await sidebar.getByTestId("sidebar-snoozed-shelf-toggle").click();
        await sidebar.getByTestId("sidebar-settled-shelf-toggle").click();

        // The shelf row shares its key with the card it becomes, so focus
        // counts only once it sits on the card in the active lane, and holds.
        const focusFollowsTo = async (key: string | null) => {
          const onMovedCard = (k: string | null) => {
            const active = document.activeElement;
            return (
              active?.getAttribute("data-sb-thread-row") === k &&
              active.getAttribute("role") === "option"
            );
          };
          await page.waitForFunction(onMovedCard, key, { timeout: 5_000 });
          await page.waitForTimeout(300);
          NodeAssert.ok(await page.evaluate(onMovedCard, key), `focus left the moved row ${key}`);
        };
        const settledRow = sidebar.getByRole("button", { name: "Settled thread", exact: true });
        await settledRow.waitFor();
        const settledRowKey = await settledRow.getAttribute("data-sb-thread-row");
        await settledRow.hover();
        await settledRow
          .locator("xpath=..")
          .getByRole("button", { name: "Un-settle thread" })
          .click();
        await focusFollowsTo(settledRowKey);

        const snoozedRow = sidebar.getByRole("button", { name: "Snoozed thread", exact: true });
        await snoozedRow.waitFor();
        const snoozedRowKey = await snoozedRow.getAttribute("data-sb-thread-row");
        await snoozedRow.hover();
        await snoozedRow
          .locator("xpath=..")
          .getByRole("button", { name: "Wake thread now" })
          .click();
        await focusFollowsTo(snoozedRowKey);
      } finally {
        await context.close();
      }
    }
    console.log(
      `aria-required-children on the Threads listbox: ${listboxFindings.length} (${listboxFindings.join(", ")})`,
    );
    // One per audited state (0 at the merge-base, before lane toggles); any growth fails.
    NodeAssert.equal(listboxFindings.length, 18);
    NodeAssert.deepEqual(violations, []);
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

      // A project's own view needs no project prefix; All projects labels each lane with it.
      const projectPrefix = `${project.title} /`;
      NodeAssert.equal(await sidebar.getByText(projectPrefix, { exact: true }).count(), 0);
      await page.goto(`${currentUrl}/`);
      await page.getByRole("heading", { name: "All projects" }).waitFor();
      await sidebar
        .locator(`[data-sb-branch-lane$=":${project.id}:br:feature/alpha"]`)
        .getByText(projectPrefix, { exact: true })
        .waitFor();
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
      const firstRow = alphaLane.getByRole("option", { name: "Alpha first", exact: true });
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
        await dndAnnouncement(page, `Picked up ${project.rows[key].title}`).waitFor({
          state: "attached",
        });
        await sidebar.getByText("Drop to pin", { exact: true }).waitFor();
        await page.mouse.move(held.x, held.y + 3);
        await page.mouse.up();
        await page.locator("[data-sb-drag-overlay]").waitFor({ state: "detached" });
        await dndAnnouncement(page, /^Thread returned$/).waitFor({ state: "attached" });
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
      await dndAnnouncement(page, "Moved thread").waitFor({ state: "attached" });
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
      // The chip's reject badge comes from drag state, not from its wording.
      await page.locator('[data-sb-drag-verb="Can\'t move here"][data-sb-drag-rejected]').waitFor();
      await page
        .getByRole("tooltip", { name: "Branch comes from the thread's worktree", exact: true })
        .waitFor();
      // A drag hides the hovered row's quick actions, which sit beside the option.
      const betaActions = row("beta").locator("xpath=..").locator(":scope > .sb-row-actions");
      NodeAssert.equal(await betaActions.count(), 1);
      NodeAssert.equal(await betaActions.isVisible(), false);
      NodeAssert.equal(
        await page.evaluate(({ x, y }) => {
          const target = document.elementFromPoint(x, y);
          return target ? getComputedStyle(target).cursor : null;
        }, pointer),
        "not-allowed",
      );
      await page.mouse.up();
      await page.locator("[data-sb-drag-overlay]").waitFor({ state: "detached" });
      await dndAnnouncement(page, "Can't move here. Thread returned.").waitFor({
        state: "attached",
      });
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
      await dndAnnouncement(page, "Pin thread: drop to pin").waitFor({ state: "attached" });
      const overlayBox = await overlay.boundingBox();
      NodeAssert.ok(overlayBox && overlayBox.height <= 40, "Drag overlay must stay a compact chip");
      await page.mouse.up();
      await pinned;
      await dndAnnouncement(page, "Pinned thread").waitFor({ state: "attached" });
      await sidebar
        .getByRole("group", { name: "Pinned, 1 thread", exact: true })
        .getByRole("option", { name: "Alpha first", exact: true })
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
      await dndAnnouncement(page, "Can't drop here").waitFor({ state: "attached" });
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
        .getByRole("option", { name: "Snoozed thread", exact: true })
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
  "group by and density persist, render every mode, and keep the legacy switch flag-gated",
  { timeout: 240_000 },
  async () => {
    const project = await seedBranchProject("qa-group-by");
    const context = await newContext({ switchboard: true });
    try {
      const page = await context.newPage();
      const sidebar = await openBranchProject(page, project);
      const trigger = sidebar.getByRole("button", { name: "Group by Branch", exact: true });
      await trigger.waitFor();
      // The header row holds the two controls and no thread count.
      NodeAssert.doesNotMatch(await sidebar.getByTestId("sidebar-group-by-row").innerText(), /\d/);
      NodeAssert.equal(await page.getByRole("switch", { name: "Group by project" }).count(), 0);

      // Keyboard: Enter opens on the checked item, Home/End move, Escape returns focus.
      await trigger.focus();
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () =>
          document.activeElement?.getAttribute("role") === "menuitemradio" &&
          document.activeElement.getAttribute("aria-checked") === "true" &&
          document.activeElement.textContent?.startsWith("Branch") === true,
      );
      // One project is scoped, so Project is left out rather than disabled.
      NodeAssert.deepEqual(
        await page
          .getByRole("menuitemradio")
          .evaluateAll((items) => items.map((item) => item.textContent?.split(/(?=[A-Z])/)[0])),
        ["Branch", "Status"],
      );
      await page.keyboard.press("End");
      await page.waitForFunction(() => document.activeElement?.textContent?.startsWith("Status"));
      await page.keyboard.press("Home");
      await page.waitForFunction(() => document.activeElement?.textContent?.startsWith("Branch"));
      await page.keyboard.press("Escape");
      await page.getByRole("menu").waitFor({ state: "hidden" });
      await page.waitForFunction(() =>
        document.activeElement?.textContent?.includes("Group by Branch"),
      );
      await page.keyboard.press("ArrowDown");
      await page.waitForFunction(() => document.activeElement?.textContent?.startsWith("Branch"));
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await sidebar.getByRole("button", { name: "Group by Status", exact: true }).waitFor();
      await waitForPersisted(page, ["sidebarGroupBy"], "status");
      await page.reload();
      await sidebar.getByRole("button", { name: "Group by Status", exact: true }).waitFor();

      // A stat filter overrides the rendered mode without writing it.
      await page.getByRole("button", { name: /worktrees, filter$/ }).click();
      await sidebar.getByRole("button", { name: "Group by Branch", exact: true }).waitFor();
      NodeAssert.equal((await readUiState(page)).sidebarGroupBy, "status");
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await sidebar.getByRole("button", { name: "Group by Status", exact: true }).waitFor();

      // All projects offers Project; scoping one project renders Branch but keeps it saved.
      await scopeFromRail(page, "All projects");
      await chooseGroupBy(page, sidebar, "Project");
      await sidebar.getByTestId("sidebar-project-group").first().waitFor();
      await sidebar.getByTestId("sidebar-snoozed-shelf-toggle").click();
      for (const mode of ["Project", "Status", "Branch"] as const) {
        await chooseGroupBy(page, sidebar, mode);
        const countdown = sidebar.locator("[data-sb-snooze-countdown]").first();
        await countdown.waitFor();
        NodeAssert.match((await countdown.getAttribute("class")) ?? "", /\btext-sb-muted\b/);
      }
      await chooseGroupBy(page, sidebar, "Project");
      await waitForPersisted(page, ["sidebarGroupBy"], "project");
      await scopeFromRail(page, project.title);
      await sidebar.getByRole("button", { name: "Group by Branch", exact: true }).waitFor();
      NodeAssert.equal((await readUiState(page)).sidebarGroupBy, "project");
      await scopeFromRail(page, "All projects");
      await sidebar.getByRole("button", { name: "Group by Project", exact: true }).waitFor();

      // Density: Compact card rows are 28px, Comfortable 48px, in every mode.
      const cardHeights = () =>
        sidebar
          .locator('[role="option"] [data-sb-thread-content]')
          .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
      const density = sidebar.getByRole("radiogroup", { name: "Density" });
      for (const mode of ["Branch", "Status", "Project"] as const) {
        await chooseGroupBy(page, sidebar, mode);
        await density.getByRole("radio", { name: "Compact" }).click();
        await sidebar.locator('[data-sb-thread-row][data-sb-density="compact"]').first().waitFor();
        const compact = await cardHeights();
        NodeAssert.ok(compact.length > 0);
        NodeAssert.deepEqual(new Set(compact), new Set([28]), `${mode} compact`);
        await density.getByRole("radio", { name: "Comfortable" }).click();
        await sidebar
          .locator('[data-sb-thread-row][data-sb-density="comfortable"]')
          .first()
          .waitFor();
        NodeAssert.deepEqual(new Set(await cardHeights()), new Set([48]), `${mode} comfortable`);
      }
      // One Tab stop; arrows change the value, and the choice persists. The
      // reload runs in one project's Branch view: rendering every project's
      // rows again is what made the wait after it slow on a loaded machine.
      await chooseGroupBy(page, sidebar, "Branch");
      await scopeFromRail(page, project.title);
      await density.getByRole("radio", { name: "Comfortable" }).focus();
      await page.keyboard.press("ArrowRight");
      const compactRadio = density
        .getByRole("radio", { name: "Compact" })
        .and(page.locator('[aria-checked="true"]'));
      await compactRadio.waitFor();
      await waitForPersisted(page, ["sidebarDensity"], "compact");
      await waitForPersisted(page, ["sidebarGroupBy"], "branch");
      await page.reload();
      // The saved choice hydrates first; the rows follow once the shell loads.
      await compactRadio.waitFor();
      const compactRow = sidebar.locator('[data-sb-thread-row][data-sb-density="compact"]').first();
      await compactRow.waitFor();
      // Compact rows are card options, not the slim shelf rows. They stack with
      // no gap, so their focus ring sits inside the row.
      NodeAssert.equal(await compactRow.getAttribute("role"), "option");
      await page.keyboard.press("Tab");
      await compactRow.focus();
      NodeAssert.deepEqual(
        await compactRow.evaluate((row) => {
          const ring = getComputedStyle(row, "::after");
          return {
            visible: row.matches(":focus-visible"),
            inset: [ring.top, ring.right, ring.bottom, ring.left],
            width: ring.borderTopWidth,
          };
        }),
        { visible: true, inset: ["0px", "0px", "0px", "0px"], width: "2px" },
      );
    } finally {
      await context.close();
    }

    // Flag off: the legacy switch is still in the scope picker and still works.
    const legacy = await newContext({ switchboard: false });
    try {
      const page = await legacy.newPage();
      await page.goto(`${currentUrl}/`);
      await page.waitForURL((url) => url.pathname.startsWith("/draft/"));
      // The scope trigger is a combobox, named by its label.
      await page.getByLabel(/^Filter threads by project/).click();
      const legacySwitch = page.getByRole("switch", { name: "Group by project" });
      await legacySwitch.waitFor();
      // Toggling it regroups the list (sidebarThreadOrganization), which is
      // what the switch is for; the flag leaves this path untouched.
      const groups = page.getByTestId("sidebar-project-group");
      const groupedBefore = (await groups.count()) > 0;
      await page.getByText("Group by project", { exact: true }).click();
      await groups.first().waitFor({ state: groupedBefore ? "detached" : "attached" });
      NodeAssert.equal(await page.getByTestId("sidebar-group-by-row").count(), 0);
      // Settings are shared with later tests; put the default back.
      await page.getByText("Group by project", { exact: true }).click();
      await groups.first().waitFor({ state: groupedBefore ? "attached" : "detached" });
    } finally {
      await legacy.close();
    }
  },
);

NodeTest.test(
  "thread rows keep a visible focus ring over the selected and hover fill",
  { timeout: 240_000 },
  async () => {
    const project = await seedBranchProject("qa-focus-ring");
    const missing: string[] = [];
    for (const colorScheme of ["light", "dark"] as const) {
      const context = await newContext({ switchboard: true, colorScheme });
      try {
        const page = await context.newPage();
        const sidebar = await openBranchProject(page, project);
        const option = (title: string) => sidebar.getByRole("option", { name: title, exact: true });
        const away = () => page.mouse.move(1000, 450);
        const holdsFocus = (row: Locator) =>
          row.evaluate((node) => document.activeElement === node && node.matches(":focus-visible"));
        const check = async (state: string, row: Locator) => {
          // Chromium tracks keyboard-vs-pointer modality per page; a real key
          // press puts it back in keyboard mode before the focus.
          await page.keyboard.press("Tab");
          await row.focus();
          NodeAssert.ok(await holdsFocus(row), `${colorScheme} ${state}: the row lost focus`);
          const sides = await focusRingSides(page, row);
          for (const [side, visible] of Object.entries(sides)) {
            if (!visible) missing.push(`${colorScheme} ${state}: ${side}`);
          }
          await row.locator("xpath=..").screenshot({
            path: NodePath.join(
              artifacts,
              `focus-ring-${state.replaceAll(" ", "-")}-${colorScheme}.png`,
            ),
            animations: "disabled",
            caret: "hide",
          });
          // Nothing took focus back while the ring was read.
          NodeAssert.ok(
            await holdsFocus(row),
            `${colorScheme} ${state}: focus left the row during the capture`,
          );
        };
        for (const density of ["Compact", "Comfortable"] as const) {
          await sidebar
            .getByRole("radiogroup", { name: "Density" })
            .getByRole("radio", { name: density })
            .click();
          await sidebar
            .locator(`[data-sb-thread-row][data-sb-density="${density.toLowerCase()}"]`)
            .first()
            .waitFor();
          const selected = option("Alpha first");
          const opensThread = (await selected.getAttribute("aria-current")) !== "page";
          await selected.click();
          await selected.and(sidebar.locator('[aria-current="page"]')).waitFor();
          // Opening a thread focuses the composer one animation frame later
          // (ChatView); let that land before the row takes focus, or it steals
          // the focus back mid-check.
          if (opensThread) {
            await page.waitForFunction(
              () =>
                document
                  .querySelector('[data-testid="composer-editor"]')
                  ?.contains(document.activeElement) === true,
            );
          }
          await afterRenders(page);
          await away();
          await check(`${density} selected`, selected);
          const hovered = option("Alpha second");
          await hovered.hover();
          await check(`${density} hovered`, hovered);
          await away();
        }
      } finally {
        await context.close();
      }
    }
    NodeAssert.deepEqual(missing, []);
  },
);

NodeTest.test(
  "only the search and rename fields drop the switchboard focus outline",
  { timeout: 120_000 },
  async () => {
    const project = await seedBranchProject("qa-field-outline");
    const context = await newContext({ switchboard: true });
    try {
      const page = await context.newPage();
      const sidebar = await openBranchProject(page, project);
      const outline = (field: Locator) =>
        field.evaluate((node) => ({
          focusVisible: node.matches(":focus-visible"),
          outlineStyle: getComputedStyle(node).outlineStyle,
        }));
      // Both fields draw their own ring, so the outline would double it.
      const search = sidebar.getByRole("combobox", { name: "Search threads" });
      await search.focus();
      NodeAssert.deepEqual(await outline(search), { focusVisible: true, outlineStyle: "none" });
      // Open the thread first: the route change remounts the row.
      const row = sidebar.getByRole("option", { name: "Alpha first", exact: true });
      await row.click();
      await row.and(sidebar.locator('[aria-current="page"]')).waitFor();
      await row.dblclick();
      const rename = sidebar.getByRole("textbox", { name: "Thread title" });
      await rename.waitFor();
      NodeAssert.deepEqual(await outline(rename), { focusVisible: true, outlineStyle: "none" });
      await page.keyboard.press("Escape");
      await rename.waitFor({ state: "detached" });
      // Any other field has no ring of its own and keeps the outline (WCAG 2.4.7).
      await sidebar.evaluate((root) => {
        const field = document.createElement("input");
        field.setAttribute("aria-label", "Plain field");
        root.append(field);
      });
      const plain = sidebar.getByRole("textbox", { name: "Plain field" });
      await plain.focus();
      NodeAssert.deepEqual(await outline(plain), { focusVisible: true, outlineStyle: "solid" });
    } finally {
      await context.close();
    }
  },
);

NodeTest.test(
  "status mode orders derived sections and refuses reorder drops without writing",
  { timeout: 240_000 },
  async () => {
    const project = await seedBranchProject("qa-status");
    const context = await newContext({ switchboard: true });
    await patchThreadShells(context, {
      [project.threadId("alphaFirst")]: { hasPendingApprovals: true },
      [project.threadId("alphaSecond")]: {
        session: qaSession(project.threadId("alphaSecond"), "error"),
      },
      [project.threadId("beta")]: { session: qaSession(project.threadId("beta"), "running") },
      // A pinned failed thread stays under Pinned.
      [project.threadId("pinFirst")]: { session: qaSession(project.threadId("pinFirst"), "error") },
    });
    try {
      const page = await context.newPage();
      const writes = observeThreadWrites(page);
      const sidebar = await openBranchProject(page, project);
      await chooseGroupBy(page, sidebar, "Status");
      const listbox = sidebar.getByRole("listbox", { name: "Threads" });
      await listbox.getByRole("heading", { name: /^Idle/ }).waitFor();
      NodeAssert.deepEqual(
        await listbox
          .getByRole("heading")
          .evaluateAll((headings) => headings.map((heading) => heading.textContent)),
        ["Needs you1", "Error1", "Running1", "Idle2"],
      );
      // Only Pinned toggles; the status headings carry no button.
      await listbox.getByRole("button", { name: "Pinned 2 threads", exact: true }).waitFor();
      const pinnedToggle = listbox.getByRole("button", { name: /^Pinned \d+ threads?$/ });
      NodeAssert.equal(await pinnedToggle.getAttribute("aria-expanded"), "true");
      NodeAssert.equal(
        await sidebar.locator("[data-sb-status-section] [data-sb-lane-header] button").count(),
        0,
      );
      const section = (key: string) => sidebar.locator(`[data-sb-status-section="${key}"]`);
      const titleIn = (key: string, title: string) =>
        section(key).getByRole("option").filter({ hasText: title });
      await titleIn("needs-you", "Alpha first").waitFor();
      await titleIn("error", "Alpha second").waitFor();
      await titleIn("running", "Beta thread").waitFor();
      await titleIn("idle", "No branch thread").waitFor();
      await titleIn("idle", "Alpha worktree").waitFor();
      for (const title of ["Pinned first", "Alpha first", "Alpha second", "Beta thread"]) {
        NodeAssert.equal(await listbox.getByRole("option").filter({ hasText: title }).count(), 1);
      }
      await sidebar
        .locator('[data-sb-branch-lane="pinned"]')
        .getByRole("option")
        .filter({ hasText: "Pinned first" })
        .waitFor();

      // Reordering inside Idle is refused: outline, badge, cursor, copy, no drop line, no write.
      const row = (title: string) => listbox.getByRole("option").filter({ hasText: title });
      const writesBefore = writes.commands.length;
      await startRowDrag(page, row("No branch thread"));
      await moveDragTo(page, row("Alpha worktree"));
      await section("idle").and(page.locator("[data-sb-drop-rejected]")).waitFor();
      await page.locator('[data-sb-drag-verb="Sorted by status"][data-sb-drag-rejected]').waitFor();
      await dndAnnouncement(page, "Can't reorder in Idle. Sorted by status.").waitFor();
      NodeAssert.equal(await page.evaluate(() => document.body.style.cursor), "not-allowed");
      NodeAssert.equal(await sidebar.locator("[data-sb-drop-indicator]").count(), 0);
      // The copy names the section under the pointer, not the row's own.
      await moveDragTo(page, row("Beta thread"));
      await dndAnnouncement(page, "Can't reorder in Running. Sorted by status.").waitFor();
      await section("running").and(page.locator("[data-sb-drop-rejected]")).waitFor();
      await page.mouse.up();
      await page.locator("[data-sb-drag-overlay]").waitFor({ state: "detached" });
      NodeAssert.deepEqual(writes.commands.slice(writesBefore), []);

      // Dropping on Pinned pins.
      const pinned = writes.next("thread.pin");
      await startRowDrag(page, row("No branch thread"));
      await moveDragTo(page, pinnedToggle);
      await page.mouse.up();
      await pinned;
      await sidebar
        .locator('[data-sb-branch-lane="pinned"]')
        .getByRole("option")
        .filter({ hasText: "No branch thread" })
        .waitFor();

      // A collapsed Pinned header still takes the drop, without opening.
      await pinnedToggle.click();
      const collapsedPinned = listbox.getByRole("button", {
        name: "Pinned 3 threads",
        exact: true,
      });
      NodeAssert.equal(await collapsedPinned.getAttribute("aria-expanded"), "false");
      await waitForPersisted(page, ["sidebarLaneCollapsed", "pinned"], true);
      const pinnedAgain = writes.next("thread.pin");
      await startRowDrag(page, row("Alpha worktree"));
      await moveDragTo(page, collapsedPinned);
      await sidebar
        .locator('[data-sb-branch-lane="pinned"][data-sb-collapsed]')
        .and(sidebar.locator(".bg-sb-selection"))
        .waitFor();
      await page.mouse.up();
      await pinnedAgain;
      await listbox.getByRole("button", { name: /^Pinned 4 threads/ }).waitFor();
      NodeAssert.equal(
        await listbox
          .getByRole("button", { name: /^Pinned 4 threads/ })
          .getAttribute("aria-expanded"),
        "false",
      );
    } finally {
      await context.close();
    }
  },
);

NodeTest.test(
  "lane headers pluralise, show pull request meta, collapse, persist, and reveal the open thread",
  { timeout: 240_000 },
  async () => {
    const project = await seedBranchProject("qa-lane-header");
    const context = await newContext({
      switchboard: true,
      // A key for a lane that no longer exists collapses nothing.
      uiState: { sidebarLaneCollapsed: { "gone-environment:gone-project:br:old": true } },
    });
    await patchThreadShells(context, {
      [project.threadId("beta")]: {
        pullRequests: [
          qaPullRequest(127, "merged", "2026-03-01T00:00:00.000Z"),
          qaPullRequest(128, "open", "2026-03-02T00:00:00.000Z"),
        ],
      },
      [project.threadId("worktree")]: {
        pullRequests: [qaPullRequest(200, "merged", "2026-03-03T00:00:00.000Z")],
      },
    });
    try {
      const page = await context.newPage();
      // It reloads with the open thread in a collapsed lane.
      const sidebar = await openBranchProject(page, project, { realClock: true });
      const listbox = sidebar.getByRole("listbox", { name: "Threads" });
      const toggles = listbox.locator("[data-sb-lane-header] button[aria-expanded]");
      await toggles.first().waitFor();
      NodeAssert.ok(
        (await toggles.evaluateAll((buttons) =>
          buttons.every((button) => button.getAttribute("aria-expanded") === "true"),
        )) === true,
      );
      const betaLane = sidebar.locator(`[data-sb-branch-lane$=":${project.id}:br:feature/beta"]`);
      const betaKey = await betaLane.getAttribute("data-sb-branch-lane");
      NodeAssert.ok(betaKey);
      // The name is the visible text plus sr-only suffixes (WCAG 2.5.3).
      const betaToggle = betaLane.getByRole("button", {
        name: "feature/beta 1 thread, 2 pull requests, showing #128 open",
        exact: true,
      });
      await betaToggle.waitFor();
      await betaLane.getByText("+1", { exact: true }).waitFor();
      // Parity: the row's PR badge is a pointer shortcut inside the option.
      // It still opens the pull request and leaves the row's route alone.
      const routeBefore = page.url();
      // The host is not reachable from tests; answer for it.
      await context.route("https://github.com/**", (route) =>
        route.fulfill({ contentType: "text/html", body: "pull request" }),
      );
      const opened = context.waitForEvent("page");
      await betaLane.locator("[data-pr-badge]").first().click();
      const popup = await opened;
      await popup.waitForURL(/github\.com\/acme\/app\/pull\/12[78]$/);
      await popup.close();
      NodeAssert.equal(page.url(), routeBefore);
      NodeAssert.equal(
        await betaLane.locator('[data-sb-lane-pr="open"]').getAttribute("aria-hidden"),
        "true",
      );

      // Merged with its worktree still there: the clean-up link replaces the tag.
      const worktreeLane = sidebar.locator(
        `[data-sb-branch-lane$=":${project.id}:wt:${project.worktree}"]`,
      );
      const cleanUp = worktreeLane.getByRole("link", { name: "PR #200 merged · clean up?" });
      await cleanUp.waitFor();
      NodeAssert.match((await cleanUp.getAttribute("href")) ?? "", /\/settings\/storage$/);
      NodeAssert.equal(await worktreeLane.getByText("worktree", { exact: true }).count(), 0);
      await cleanUp.click();
      await page.waitForURL((url) => url.pathname.endsWith("/settings/storage"));
      await page.goBack({ waitUntil: "commit" });
      const worktreeToggle = worktreeLane.locator("[data-sb-lane-header] button[aria-expanded]");
      await worktreeToggle.waitFor();
      NodeAssert.equal(await worktreeToggle.getAttribute("aria-expanded"), "true");

      // Collapse persists across a reload and drops the lane's rows.
      const row = (key: keyof typeof project.rows) =>
        sidebar.locator(`[data-sb-thread-row$=":${project.threadId(key)}"]`);
      await betaToggle.click();
      NodeAssert.equal(await betaToggle.getAttribute("aria-expanded"), "false");
      await row("beta").waitFor({ state: "detached" });
      await waitForPersisted(page, ["sidebarLaneCollapsed", betaKey], true);
      await page.reload();
      await betaToggle.waitFor();
      NodeAssert.equal(await betaToggle.getAttribute("aria-expanded"), "false");
      const mod = await page.evaluate(() => (/Mac/.test(navigator.platform) ? "Meta" : "Control"));

      // The open thread inside a collapsed lane: the rail and the description.
      await betaToggle.click();
      await row("beta").click();
      await page.waitForURL((url) => url.pathname.endsWith(`/${project.threadId("beta")}`));
      await betaToggle.click();
      await betaLane.locator("[data-sb-open-thread-mark]").waitFor();
      await page.reload();
      await betaLane.locator("[data-sb-open-thread-mark]").waitFor();
      NodeAssert.equal(await betaToggle.getAttribute("aria-expanded"), "false");
      NodeAssert.match(
        (await accessibleText(page, `[data-sb-branch-lane="${betaKey}"] [aria-expanded]`))
          .description ?? "",
        /contains the open thread/,
      );
      // A sidebar click elsewhere does not reveal it; the palette does.
      await row("alphaFirst").click();
      await page.waitForURL((url) => url.pathname.endsWith(`/${project.threadId("alphaFirst")}`));
      NodeAssert.equal(await betaToggle.getAttribute("aria-expanded"), "false");
      await page.keyboard.press(`${mod}+KeyK`);
      // A role=dialog lookup also matches a toast that can appear mid-test.
      const palette = page.getByTestId("command-palette");
      await palette.waitFor();
      await page.keyboard.type("Beta thread");
      await palette.getByText("Beta thread", { exact: true }).first().click();
      await page.waitForURL((url) => url.pathname.endsWith(`/${project.threadId("beta")}`));
      await row("beta").waitFor();
      NodeAssert.equal(await betaToggle.getAttribute("aria-expanded"), "true");
      await waitForPersisted(page, ["sidebarLaneCollapsed", betaKey], false);
      await row("beta").and(sidebar.locator('[aria-current="page"]')).waitFor();
      NodeAssert.ok(await onScreen(row("beta")), "The revealed row is not on screen");
    } finally {
      await context.close();
    }
  },
);

NodeTest.test(
  "next and previous thread reach rows in collapsed lanes and reveal them; range select skips them",
  { timeout: 180_000 },
  async () => {
    const project = await seedBranchProject("qa-reveal-traversal");
    const context = await newContext({ switchboard: true });
    try {
      const page = await context.newPage();
      const sidebar = await openBranchProject(page, project);
      const listbox = sidebar.getByRole("listbox", { name: "Threads" });
      const row = (key: keyof typeof project.rows) =>
        sidebar.locator(`[data-sb-thread-row$=":${project.threadId(key)}"]`);
      const opened = async (key: keyof typeof project.rows) => {
        await page.waitForURL((url) => url.pathname.endsWith(`/${project.threadId(key)}`));
        await row(key).and(sidebar.locator('[aria-current="page"]')).waitFor();
      };
      const betaLane = sidebar.locator(`[data-sb-branch-lane$=":${project.id}:br:feature/beta"]`);
      const betaKey = await betaLane.getAttribute("data-sb-branch-lane");
      NodeAssert.ok(betaKey);
      const betaToggle = betaLane.locator("[data-sb-lane-header] button[aria-expanded]");
      const pinnedToggle = listbox.getByRole("button", { name: /^Pinned \d+ threads?$/ });
      const mod = await page.evaluate(() => (/Mac/.test(navigator.platform) ? "Meta" : "Control"));

      await betaToggle.click();
      await row("beta").waitFor({ state: "detached" });
      await waitForPersisted(page, ["sidebarLaneCollapsed", betaKey], true);
      // Range select follows what is on screen: the collapsed lane's row is left out.
      await row("worktree").click();
      await opened("worktree");
      await row("alphaFirst").click({ modifiers: ["Shift"] });
      NodeAssert.deepEqual(
        await sidebar
          .locator('[data-sb-thread-row][aria-selected="true"]')
          .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-sb-thread-row"))),
        (["worktree", "alphaFirst"] as const).map((key) =>
          betaKey.replace(`:${project.id}:br:feature/beta`, `:${project.threadId(key)}`),
        ),
      );

      // Next thread lands on the hidden row, opens its lane and scrolls to it.
      await row("worktree").click();
      await opened("worktree");
      await page.keyboard.press(`${mod}+Shift+BracketRight`);
      await opened("beta");
      NodeAssert.equal(await betaToggle.getAttribute("aria-expanded"), "true");
      await waitForPersisted(page, ["sidebarLaneCollapsed", betaKey], false);
      NodeAssert.ok(await onScreen(row("beta")), "The revealed row is not on screen");

      // Previous thread does the same for a collapsed Pinned lane.
      await pinnedToggle.click();
      await waitForPersisted(page, ["sidebarLaneCollapsed", "pinned"], true);
      await row("worktree").click();
      await opened("worktree");
      await page.keyboard.press(`${mod}+Shift+BracketLeft`);
      await opened("pinFirst");
      NodeAssert.equal(await pinnedToggle.getAttribute("aria-expanded"), "true");
      await waitForPersisted(page, ["sidebarLaneCollapsed", "pinned"], false);
    } finally {
      await context.close();
    }

    // Status mode: Pinned is the only section with a toggle, but a collapse key
    // saved for a Status section still takes its rows out of the drawn order,
    // so next/previous reveals that section the same way.
    const statusContext = await newContext({
      switchboard: true,
      uiState: {
        sidebarGroupBy: "status",
        sidebarLaneCollapsed: { pinned: true, "status:idle": true },
      },
    });
    try {
      const page = await statusContext.newPage();
      const sidebar = await openBranchProject(page, project);
      const listbox = sidebar.getByRole("listbox", { name: "Threads" });
      await listbox.getByRole("heading", { name: /^Idle/ }).waitFor();
      const pinnedToggle = listbox.getByRole("button", { name: /^Pinned \d+ threads?$/ });
      NodeAssert.equal(await pinnedToggle.getAttribute("aria-expanded"), "false");
      const idleRows = sidebar.locator('[data-sb-status-section="idle"] [data-sb-thread-row]');
      const pinnedRows = sidebar.locator('[data-sb-branch-lane="pinned"] [data-sb-thread-row]');
      const current = sidebar.locator('[aria-current="page"]');
      const mod = await page.evaluate(() => (/Mac/.test(navigator.platform) ? "Meta" : "Control"));

      await idleRows.first().click();
      await idleRows.first().and(current).waitFor();
      // Previous thread lands on the collapsed Pinned section's last row and opens it.
      await page.keyboard.press(`${mod}+Shift+BracketLeft`);
      await pinnedRows.last().and(current).waitFor();
      NodeAssert.equal(await pinnedToggle.getAttribute("aria-expanded"), "true");
      await waitForPersisted(page, ["sidebarLaneCollapsed", "pinned"], false);
      NodeAssert.ok(await onScreen(pinnedRows.last()), "The revealed row is not on screen");
      // Next thread goes back into Idle and clears its collapse key.
      await page.keyboard.press(`${mod}+Shift+BracketRight`);
      await idleRows.first().and(current).waitFor();
      await waitForPersisted(page, ["sidebarLaneCollapsed", "status:idle"], false);
      NodeAssert.ok(await onScreen(idleRows.first()), "The revealed row is not on screen");
    } finally {
      await statusContext.close();
    }
  },
);

NodeTest.test(
  "a deep link reveals its thread's collapsed lane, and a reload keeps it collapsed",
  { timeout: 180_000 },
  async () => {
    const project = await seedBranchProject("qa-reveal-deep-link");
    let betaKey: string | null = null;
    let betaPath = "";
    const setup = await newContext({ switchboard: true });
    try {
      const page = await setup.newPage();
      const sidebar = await openBranchProject(page, project);
      betaKey = await sidebar
        .locator(`[data-sb-branch-lane$=":${project.id}:br:feature/beta"]`)
        .getAttribute("data-sb-branch-lane");
      await sidebar.locator(`[data-sb-thread-row$=":${project.threadId("beta")}"]`).click();
      await page.waitForURL((url) => url.pathname.endsWith(`/${project.threadId("beta")}`));
      betaPath = new URL(page.url()).pathname;
    } finally {
      await setup.close();
    }
    NodeAssert.ok(betaKey);
    // A fresh page load at the thread's URL, with its lane saved as collapsed.
    const context = await newContext({
      switchboard: true,
      uiState: { sidebarLaneCollapsed: { [betaKey]: true } },
    });
    try {
      const page = await context.newPage();
      // No fake clock: the page must tell this fresh load from the reload below.
      await page.goto(`${currentUrl}${betaPath}`);
      const sidebar = page.locator('[data-switchboard="sidebar"]').first();
      const betaLane = sidebar.locator(`[data-sb-branch-lane="${betaKey}"]`);
      const betaToggle = betaLane.locator("[data-sb-lane-header] button[aria-expanded]");
      const betaRow = sidebar.locator(`[data-sb-thread-row$=":${project.threadId("beta")}"]`);
      await waitForPersisted(page, ["sidebarLaneCollapsed", betaKey], false);
      await betaRow.and(sidebar.locator('[aria-current="page"]')).waitFor();
      NodeAssert.equal(await betaToggle.getAttribute("aria-expanded"), "true");
      NodeAssert.ok(await onScreen(betaRow), "The revealed row is not on screen");

      // A reload is rest: the lane stays collapsed and marks the open thread.
      await betaToggle.click();
      await waitForPersisted(page, ["sidebarLaneCollapsed", betaKey], true);
      await page.reload();
      await betaLane.locator("[data-sb-open-thread-mark]").waitFor();
      await afterRenders(page);
      NodeAssert.equal(await betaToggle.getAttribute("aria-expanded"), "false");
      NodeAssert.equal((await readUiState(page)).sidebarLaneCollapsed?.[betaKey], true);
    } finally {
      await context.close();
    }
  },
);

NodeTest.test(
  "a reveal for a thread outside the rendered lanes is dropped, not left pending",
  { timeout: 180_000 },
  async () => {
    const project = await seedBranchProject("qa-reveal-pending");
    const context = await newContext({ switchboard: true });
    try {
      const page = await context.newPage();
      const sidebar = await openBranchProject(page, project);
      const laneSuffix = `:${project.id}:br:feature/beta`;
      const betaLane = sidebar.locator(`[data-sb-branch-lane$="${laneSuffix}"]`);
      const betaKey = await betaLane.getAttribute("data-sb-branch-lane");
      NodeAssert.ok(betaKey);
      const betaToggle = betaLane.locator("[data-sb-lane-header] button[aria-expanded]");
      const betaPath = `/${betaKey.slice(0, -laneSuffix.length)}/${project.threadId("beta")}`;
      await betaToggle.click();
      await waitForPersisted(page, ["sidebarLaneCollapsed", betaKey], true);

      // Another project is in view, so the opened thread has no lane to reveal.
      await scopeFromRail(page, "Switchboard QA");
      await navigateFromOutside(page, betaPath);
      await afterRenders(page);
      // Bringing its project back is a sidebar action, not a reveal: the lane
      // stays collapsed and marks the open thread.
      await scopeFromRail(page, project.title);
      await betaLane.waitFor();
      await afterRenders(page);
      NodeAssert.equal(await betaToggle.getAttribute("aria-expanded"), "false");
      await betaLane.locator("[data-sb-open-thread-mark]").waitFor();
      NodeAssert.equal((await readUiState(page)).sidebarLaneCollapsed?.[betaKey], true);
    } finally {
      await context.close();
    }
  },
);

NodeTest.test(
  "group-by modes, densities, the menu and lane states have no critical or serious axe violations",
  { timeout: 300_000 },
  async () => {
    const project = await seedBranchProject("qa-c2b-a11y");
    const violations: string[] = [];
    const listboxFindings: string[] = [];
    for (const colorScheme of ["dark", "light"] as const) {
      const context = await newContext({ switchboard: true, colorScheme });
      await patchThreadShells(context, {
        [project.threadId("beta")]: {
          pullRequests: [
            qaPullRequest(127, "closed", "2026-03-01T00:00:00.000Z"),
            qaPullRequest(128, "open", "2026-03-02T00:00:00.000Z", true),
          ],
        },
        [project.threadId("worktree")]: {
          pullRequests: [qaPullRequest(200, "merged", "2026-03-03T00:00:00.000Z")],
        },
        [project.threadId("alphaFirst")]: {
          pullRequests: [qaPullRequest(210, "open", "2026-03-04T00:00:00.000Z")],
          hasPendingApprovals: true,
        },
        [project.threadId("alphaSecond")]: {
          session: qaSession(project.threadId("alphaSecond"), "error"),
        },
      });
      try {
        const page = await context.newPage();
        const sidebar = await openBranchProject(page, project);
        const audit = async (state: string, scope = '[data-switchboard="sidebar"]') => {
          for (const violation of await seriousAxeViolations(page, scope)) {
            if (isThreadListboxStructureFinding(violation)) {
              listboxFindings.push(`${colorScheme} ${state}`);
              continue;
            }
            violations.push(`${colorScheme} ${state}: ${violation}`);
          }
        };
        const away = () => page.mouse.move(1000, 450);
        await away();
        await sidebar.getByRole("link", { name: "PR #200 merged · clean up?" }).waitFor();
        for (const density of ["Comfortable", "Compact"] as const) {
          await sidebar
            .getByRole("radiogroup", { name: "Density" })
            .getByRole("radio", { name: density })
            .click();
          await away();
          await audit(`branch ${density}`);
          await chooseGroupBy(page, sidebar, "Status");
          await sidebar.getByRole("heading", { name: /^Needs you/ }).waitFor();
          await away();
          await audit(`status ${density}`);
          await chooseGroupBy(page, sidebar, "Branch");
        }
        await sidebar.getByRole("button", { name: "Group by Branch", exact: true }).click();
        await page.getByRole("menu").waitFor();
        await audit("group by menu open", "[data-switchboard]");
        await page.keyboard.press("Escape");
        await page.getByRole("menu").waitFor({ state: "hidden" });
        // Collapsed lane with the open thread, and collapsed Pinned.
        const betaLane = sidebar.locator(`[data-sb-branch-lane$=":${project.id}:br:feature/beta"]`);
        await betaLane.getByRole("option").first().click();
        await betaLane.locator("[data-sb-lane-header] button[aria-expanded]").click();
        await betaLane.locator("[data-sb-open-thread-mark]").waitFor();
        await sidebar.getByRole("button", { name: /^Pinned 2 threads/ }).click();
        await away();
        await audit("collapsed lane and collapsed Pinned");
        await openAllProjects(page);
        await chooseGroupBy(page, sidebar, "Project");
        await sidebar.getByTestId("sidebar-project-group").first().waitFor();
        for (const density of ["Compact", "Comfortable"] as const) {
          await sidebar
            .getByRole("radiogroup", { name: "Density" })
            .getByRole("radio", { name: density })
            .click();
          await away();
          await audit(`project ${density}`);
        }
        await chooseGroupBy(page, sidebar, "Branch");
      } finally {
        await context.close();
      }
    }
    // Reported in the PR; the ENG-29 follow-up removes these.
    console.log(
      `aria-required-children on the Threads listbox: ${listboxFindings.length} (${listboxFindings.join(", ")})`,
    );
    // One per audited state; any growth fails.
    NodeAssert.equal(listboxFindings.length, 16);
    NodeAssert.deepEqual(violations, []);
  },
);

NodeTest.test(
  "flags-off sidebar and settings snapshots are pixel-identical to PR base",
  { timeout: 300_000 },
  async () => {
    for (const colorScheme of ["dark", "light"] as const) {
      const schemeContext = await newContext({ colorScheme, snoozedShelfExpanded: true });
      try {
        for (const surface of ["sidebar", "settings"] as const) {
          const expected = await snapshot(schemeContext, mainUrl, surface);
          const actual = await snapshot(schemeContext, currentUrl, surface);
          const name = `${surface}-${colorScheme}`;
          await NodeFSP.writeFile(NodePath.join(artifacts, `${name}-main.png`), expected);
          await NodeFSP.writeFile(NodePath.join(artifacts, `${name}-current.png`), actual);
          NodeAssert.ok(
            actual.equals(expected),
            `${name} flags-off screenshot differs from the PR base; inspect ${artifacts}`,
          );
        }
      } finally {
        await schemeContext.close();
      }
    }
    const context = await newContext();
    try {
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
  for (const [id, title] of stripProjects) {
    const root = NodePath.join(sandbox, id);
    await NodeFSP.mkdir(root, { recursive: true });
    await exec("git", ["init", "--quiet", root]);
    await dispatchFixture({
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
