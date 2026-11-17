import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { resolveElectronLaunchCommand } from "./electron-launcher.mjs";
import { STARTUP_RECORD_FILE_NAME, validateStartupRecordLog } from "./startup-record.mjs";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const desktopDir = NodePath.resolve(__dirname, "..");
const mainJs = NodePath.resolve(desktopDir, "dist-electron/main.cjs");

// The launch runs until it has logged its startup record and first memory sample. The cap
// sits above the record's 120 s deadline, so even a launch that never settles writes one.
const LAUNCH_CAP_MS = 150_000;
const EXIT_GRACE_MS = 30_000;
const READY_LOG_MESSAGES = ["desktop startup record written", "desktop startup memory sampled"];
const FATAL_PATTERNS = [
  "Cannot find module",
  "MODULE_NOT_FOUND",
  "Refused to execute",
  "Uncaught Error",
  "Uncaught TypeError",
  "Uncaught ReferenceError",
];

// Everything the app derives from the home directory or the E6 home points into a fresh temp
// dir: the database, the Chromium profile with its single-instance lock, and the app control
// socket. The live install is never touched.
const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "e6-desktop-smoke-"));
const e6Home = NodePath.join(home, "e6");
const recordPath = NodePath.join(e6Home, "userdata", "logs", STARTUP_RECORD_FILE_NAME);
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  APPDATA: NodePath.join(home, "AppData", "Roaming"),
  LOCALAPPDATA: NodePath.join(home, "AppData", "Local"),
  XDG_CONFIG_HOME: NodePath.join(home, ".config"),
  XDG_DATA_HOME: NodePath.join(home, ".local", "share"),
  E6CODE_HOME: e6Home,
  VITE_DEV_SERVER_URL: "",
  ELECTRON_ENABLE_LOGGING: "1",
};
delete env.E6CODE_PORT;

console.log(`\nLaunching Electron smoke test in ${home}...`);

// On macOS, safe storage can block the main process on a keychain access prompt for this
// unsigned build; the mock keychain keeps the run unattended.
const electronCommand = resolveElectronLaunchCommand([mainJs, "--use-mock-keychain"]);
const child = NodeChildProcess.spawn(electronCommand.electronPath, electronCommand.args, {
  stdio: ["ignore", "pipe", "pipe"],
  env,
});

let output = "";
let stopping = false;
let forceKillTimer;
const stop = () => {
  if (stopping) return;
  stopping = true;
  clearTimeout(capTimer);
  child.kill("SIGTERM");
  forceKillTimer = setTimeout(() => {
    console.error("Electron did not exit after SIGTERM; killing it. Its backend may outlive it.");
    child.kill("SIGKILL");
  }, EXIT_GRACE_MS);
};
const capTimer = setTimeout(stop, LAUNCH_CAP_MS);
const collect = (chunk) => {
  output += chunk.toString();
  if (READY_LOG_MESSAGES.every((message) => output.includes(message))) stop();
};
child.stdout.on("data", collect);
child.stderr.on("data", collect);

child.on("exit", () => {
  clearTimeout(capTimer);
  clearTimeout(forceKillTimer);

  const failures = FATAL_PATTERNS.filter((pattern) => output.includes(pattern));
  if (!NodeFS.existsSync(recordPath)) {
    failures.push(`startup record not written to ${recordPath}`);
  } else {
    const problems = validateStartupRecordLog(NodeFS.readFileSync(recordPath, "utf8"));
    failures.push(...problems.map((problem) => `startup record: ${problem}`));
  }

  if (failures.length > 0) {
    console.error("\nDesktop smoke test failed:");
    for (const failure of failures) {
      console.error(` - ${failure}`);
    }
    console.error(`\nState kept in ${home}`);
    console.error("\nFull output:\n" + output);
    process.exit(1);
  }

  NodeFS.rmSync(home, { recursive: true, force: true });
  console.log("Desktop smoke test passed.");
  process.exit(0);
});
