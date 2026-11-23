// @effect-diagnostics nodeBuiltinImport:off - exercises the real filesystem the run-root guards resolve against.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { ServerSettings } from "@e6tools/contracts/settings";
import * as Schema from "effect/Schema";
import { afterAll, describe, expect, it } from "vite-plus/test";

import {
  buildServerSettings,
  checkOutDir,
  findUnsafeHome,
  isSameOrInside,
  liveHomeCandidates,
  realPathThroughAncestors,
  scrubChildEnv,
} from "./runRoot.ts";

const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);

describe("isSameOrInside", () => {
  it("matches the directory itself and anything below it", () => {
    expect(isSameOrInside("/Users/me/.e6", "/Users/me/.e6")).toBe(true);
    expect(isSameOrInside("/Users/me/.e6", "/Users/me/.e6/dev/userdata")).toBe(true);
  });

  it("does not match a sibling that shares a prefix", () => {
    expect(isSameOrInside("/Users/me/.e6", "/Users/me/.e6-perf")).toBe(false);
    expect(isSameOrInside("/Users/me/.e6", "/Users/me")).toBe(false);
  });
});

describe("liveHomeCandidates", () => {
  it("names ~/.e6 for every account home and a configured E6CODE_HOME", () => {
    expect(
      liveHomeCandidates({
        accountHomes: ["/Users/me", "/Users/me"],
        env: { E6CODE_HOME: " /srv/e6 " },
      }),
    ).toEqual(["/Users/me/.e6", "/srv/e6"]);
  });

  it("expands a ~ in E6CODE_HOME against the account home, as the server does", () => {
    for (const [configured, expected] of [
      ["~/x", "/Users/me/x"],
      [" ~/x ", "/Users/me/x"],
      ["~\\x", "/Users/me/x"],
      ["~", "/Users/me"],
    ] as const) {
      expect(
        liveHomeCandidates({ accountHomes: ["/Users/me"], env: { E6CODE_HOME: configured } }),
        configured,
      ).toEqual(["/Users/me/.e6", expected]);
    }
  });

  it("refuses --out inside a ~-relative E6CODE_HOME", () => {
    const liveHomes = liveHomeCandidates({
      accountHomes: ["/Users/me"],
      env: { E6CODE_HOME: "~/e6-live" },
    });
    expect(
      checkOutDir({
        outDir: "/Users/me/e6-live/userdata",
        repoRoot: "/work/e6code",
        ignoredByGit: false,
        liveHomes,
      }),
    ).toMatchObject({ ok: false });
  });

  it("ignores a blank E6CODE_HOME", () => {
    expect(liveHomeCandidates({ accountHomes: ["/home/ci"], env: { E6CODE_HOME: " " } })).toEqual([
      "/home/ci/.e6",
    ]);
  });
});

describe("realPathThroughAncestors", () => {
  const base = NodeFS.realpathSync.native(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "e6-perf-case-")),
  );
  const home = NodePath.join(base, "Live-Home");
  NodeFS.mkdirSync(home);
  const caseVariant = NodePath.join(base, "lIVE-hOME");
  const caseInsensitive = NodeFS.existsSync(caseVariant);
  afterAll(() => NodeFS.rmSync(base, { recursive: true, force: true }));

  it.skipIf(!caseInsensitive)(
    "spells a case-variant path the way the filesystem does, so guards compare equal",
    () => {
      expect(realPathThroughAncestors(caseVariant)).toBe(home);
      expect(realPathThroughAncestors(NodePath.join(caseVariant, "out", "logs"))).toBe(
        NodePath.join(home, "out", "logs"),
      );
    },
  );
});

describe("findUnsafeHome", () => {
  const liveHomes = ["/Users/me/.e6", "/srv/e6"];

  it("refuses the live home and anything inside it", () => {
    expect(findUnsafeHome({ home: "/Users/me/.e6", liveHomes })).toBe("/Users/me/.e6");
    expect(findUnsafeHome({ home: "/Users/me/.e6/dev", liveHomes })).toBe("/Users/me/.e6");
    expect(findUnsafeHome({ home: "/srv/e6/userdata", liveHomes })).toBe("/srv/e6");
  });

  it("refuses a home that would contain a live home", () => {
    expect(findUnsafeHome({ home: "/Users/me", liveHomes })).toBe("/Users/me/.e6");
  });

  it("accepts a throwaway home elsewhere", () => {
    expect(findUnsafeHome({ home: "/var/folders/x/T/e6-perf-1/homes/coldLoad", liveHomes })).toBe(
      null,
    );
  });
});

describe("checkOutDir", () => {
  const repoRoot = "/work/e6code";
  const liveHomes = ["/Users/me/.e6", "/srv/e6"];

  it("accepts a directory outside the repository", () => {
    expect(
      checkOutDir({ outDir: "/tmp/e6-perf/run", repoRoot, ignoredByGit: false, liveHomes }),
    ).toEqual({ ok: true });
  });

  it("accepts a git-ignored directory inside the repository", () => {
    expect(
      checkOutDir({ outDir: "/work/e6code/.e6/perf", repoRoot, ignoredByGit: true, liveHomes }),
    ).toEqual({ ok: true });
  });

  it("refuses a tracked location inside the repository", () => {
    const result = checkOutDir({
      outDir: "/work/e6code/reports",
      repoRoot,
      ignoredByGit: false,
      liveHomes,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses the repository root itself", () => {
    expect(checkOutDir({ outDir: repoRoot, repoRoot, ignoredByGit: true, liveHomes }).ok).toBe(
      false,
    );
  });

  it("refuses a live home and anything under it", () => {
    for (const outDir of ["/Users/me/.e6", "/Users/me/.e6/perf", "/srv/e6/userdata/logs"]) {
      const result = checkOutDir({ outDir, repoRoot, ignoredByGit: false, liveHomes });
      expect(result, outDir).toMatchObject({ ok: false });
      expect(result.ok === false && result.reason, outDir).toContain("live E6 home");
    }
  });

  it("accepts a directory beside a live home or containing one, which it never removes", () => {
    for (const outDir of ["/Users/me/.e6-perf", "/Users/me/perf", "/Users/me"]) {
      expect(checkOutDir({ outDir, repoRoot, ignoredByGit: false, liveHomes }), outDir).toEqual({
        ok: true,
      });
    }
  });
});

describe("scrubChildEnv", () => {
  const parent = {
    PATH: "/usr/bin",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    TMPDIR: "/var/folders/x/T/",
    TZ: "UTC",
    USER: "me",
    LOGNAME: "me",
    TERM: "xterm-256color",
    HOME: "/Users/me",
    E6CODE_HOME: "/Users/me/.e6",
    E6CODE_DEV_AUTH_TOKEN: "secret",
    VITE_HTTP_URL: "http://localhost:3773",
    VITE_WS_URL: "ws://localhost:3773",
    VITE_ANYTHING: "1",
    GIT_DIR: "/Users/me/repo/.git",
    UNSET: undefined,
  };
  const credentials = {
    GH_TOKEN: "gh-secret",
    GITHUB_TOKEN: "gh-secret",
    NPM_TOKEN: "npm-secret",
    DB_PASSWORD: "db-secret",
    OPENAI_API_KEY: "openai-secret",
    ANTHROPIC_API_KEY: "anthropic-secret",
    BITBUCKET_USERNAME: "me",
    BITBUCKET_APP_PASSWORD: "bb-secret",
    SSH_AUTH_SOCK: "/private/tmp/ssh-agent.sock",
    NODE_OPTIONS: "--require /Users/me/hook.js",
    AWS_SECRET_ACCESS_KEY: "aws-secret",
  };

  it("passes only the allowlisted parent variables", () => {
    const env = scrubChildEnv(
      { ...parent, ...credentials },
      { fakeHome: "/run/fake-home", shell: "/run/bin/sh" },
    );
    expect(env).toMatchObject({
      PATH: "/usr/bin",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      TMPDIR: "/var/folders/x/T/",
      TZ: "UTC",
      USER: "me",
      LOGNAME: "me",
      TERM: "xterm-256color",
    });
    for (const key of [...Object.keys(credentials), "E6CODE_HOME", "E6CODE_DEV_AUTH_TOKEN"]) {
      expect(env[key], key).toBeUndefined();
    }
    expect(Object.keys(env).filter((key) => key.startsWith("VITE_"))).toEqual([]);
    expect(env.GIT_DIR).toBeUndefined();
    expect("UNSET" in env).toBe(false);
    expect(Object.values(env).filter((value) => value.includes("secret"))).toEqual([]);
  });

  it("keeps the Windows system variables whatever their case", () => {
    const env = scrubChildEnv(
      {
        Path: "C:\\Windows\\system32",
        SystemRoot: "C:\\Windows",
        windir: "C:\\Windows",
        ComSpec: "C:\\Windows\\system32\\cmd.exe",
        PATHEXT: ".COM;.EXE",
        TEMP: "C:\\Temp",
        TMP: "C:\\Temp",
        USERPROFILE: "C:\\Users\\me",
      },
      { fakeHome: "C:\\run\\fake-home", shell: "C:\\run\\bin\\sh" },
    );
    expect(env).toMatchObject({
      Path: "C:\\Windows\\system32",
      SystemRoot: "C:\\Windows",
      windir: "C:\\Windows",
      ComSpec: "C:\\Windows\\system32\\cmd.exe",
      PATHEXT: ".COM;.EXE",
      TEMP: "C:\\Temp",
      TMP: "C:\\Temp",
    });
    expect(env.USERPROFILE).toBeUndefined();
  });

  it("forces the file secret store, a fake HOME and SHELL, and unsigned git", () => {
    const env = scrubChildEnv(parent, { fakeHome: "/run/fake-home", shell: "/run/bin/sh" });
    expect(env).toMatchObject({
      E6CODE_SECRET_STORE: "file",
      HOME: "/run/fake-home",
      XDG_CONFIG_HOME: "/run/fake-home/.config",
      SHELL: "/run/bin/sh",
      NO_COLOR: "1",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "commit.gpgsign",
      GIT_CONFIG_VALUE_0: "false",
      GIT_CONFIG_KEY_1: "tag.gpgsign",
      GIT_CONFIG_VALUE_1: "false",
    });
  });

  it("puts the probe directory first on PATH", () => {
    const env = scrubChildEnv(parent, {
      fakeHome: "/run/fake-home",
      shell: "/run/bin/sh",
      pathPrefix: "/run/probe-bin",
    });
    expect(env.PATH).toBe("/run/probe-bin:/usr/bin");
  });

  it("adds the scenario's own E6CODE_ variables", () => {
    const env = scrubChildEnv(parent, {
      fakeHome: "/run/fake-home",
      shell: "/run/bin/sh",
      extra: { E6CODE_PROVIDER_REPLAY: "/a.ndjson,/b.ndjson" },
    });
    expect(env.E6CODE_PROVIDER_REPLAY).toBe("/a.ndjson,/b.ndjson");
  });

  it("refuses to pass any VITE_ variable or to undo the file secret store", () => {
    expect(() =>
      scrubChildEnv(parent, {
        fakeHome: "/run/fake-home",
        shell: "/run/bin/sh",
        extra: { VITE_WS_URL: "ws://127.0.0.1:1" },
      }),
    ).toThrow(/VITE_WS_URL/);
    expect(() =>
      scrubChildEnv(parent, {
        fakeHome: "/run/fake-home",
        shell: "/run/bin/sh",
        extra: { E6CODE_SECRET_STORE: "keychain" },
      }),
    ).toThrow(/E6CODE_SECRET_STORE/);
  });
});

describe("buildServerSettings", () => {
  const settings = buildServerSettings({
    replayedKinds: ["cursor", "claudeAgent", "codex", "opencode"],
    defaultModel: { instanceId: "cursor", model: "composer-2" },
  });

  it("decodes as server settings", () => {
    expect(() => decodeServerSettings(settings)).not.toThrow();
  });

  it("enables only the replayed kinds and points model selections at the default", () => {
    const decoded = decodeServerSettings(settings);
    expect(decoded.providers.cursor.enabled).toBe(true);
    expect(decoded.providers.opencode.enabled).toBe(true);
    expect(decoded.providers.grok.enabled).toBe(false);
    expect(decoded.providers.antigravity.enabled).toBe(false);
    expect(decoded.enableProviderUpdateChecks).toBe(false);
    expect(decoded.defaultModelSelection).toMatchObject({ instanceId: "cursor" });
    expect(decoded.textGenerationModelSelection).toMatchObject({ instanceId: "cursor" });
    expect(decoded.responseStreamingMode).toBe("paragraph");
  });
});
