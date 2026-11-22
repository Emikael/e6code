import { ServerSettings } from "@e6tools/contracts/settings";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  buildServerSettings,
  checkOutDir,
  findUnsafeHome,
  isSameOrInside,
  liveHomeCandidates,
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

  it("ignores a blank E6CODE_HOME", () => {
    expect(liveHomeCandidates({ accountHomes: ["/home/ci"], env: { E6CODE_HOME: " " } })).toEqual([
      "/home/ci/.e6",
    ]);
  });
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

  it("accepts a directory outside the repository", () => {
    expect(checkOutDir({ outDir: "/tmp/e6-perf/run", repoRoot, ignoredByGit: false })).toEqual({
      ok: true,
    });
  });

  it("accepts a git-ignored directory inside the repository", () => {
    expect(checkOutDir({ outDir: "/work/e6code/.e6/perf", repoRoot, ignoredByGit: true })).toEqual({
      ok: true,
    });
  });

  it("refuses a tracked location inside the repository", () => {
    const result = checkOutDir({ outDir: "/work/e6code/reports", repoRoot, ignoredByGit: false });
    expect(result.ok).toBe(false);
  });

  it("refuses the repository root itself", () => {
    expect(checkOutDir({ outDir: repoRoot, repoRoot, ignoredByGit: true }).ok).toBe(false);
  });
});

describe("scrubChildEnv", () => {
  const parent = {
    PATH: "/usr/bin",
    LANG: "en_US.UTF-8",
    HOME: "/Users/me",
    E6CODE_HOME: "/Users/me/.e6",
    E6CODE_DEV_AUTH_TOKEN: "secret",
    VITE_HTTP_URL: "http://localhost:3773",
    VITE_WS_URL: "ws://localhost:3773",
    VITE_ANYTHING: "1",
    UNSET: undefined,
  };

  it("drops every E6CODE_ and VITE_ variable and keeps the rest", () => {
    const env = scrubChildEnv(parent, { fakeHome: "/run/fake-home", shell: "/run/bin/sh" });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.LANG).toBe("en_US.UTF-8");
    expect(Object.keys(env).filter((key) => key.startsWith("VITE_"))).toEqual([]);
    expect(env.E6CODE_HOME).toBeUndefined();
    expect(env.E6CODE_DEV_AUTH_TOKEN).toBeUndefined();
    expect("UNSET" in env).toBe(false);
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
