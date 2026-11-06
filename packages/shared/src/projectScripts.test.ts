import type { ProjectScript } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { isWorktreeSetupStale, projectScriptHash } from "./projectScripts.ts";

const setup: ProjectScript = {
  id: "setup",
  name: "Setup worktree",
  command: "pnpm install",
  icon: "configure",
  runOnWorktreeCreate: true,
};

describe("projectScriptHash", () => {
  it("is stable across releases, since recorded hashes are compared later", () => {
    // Changing the algorithm would flag every recorded worktree as changed.
    expect(projectScriptHash({ command: "" })).toBe("811c9dc5");
    expect(projectScriptHash({ command: "pnpm install" })).toBe(
      projectScriptHash({ command: "pnpm install" }),
    );
    expect(projectScriptHash({ command: "pnpm install" })).not.toBe(
      projectScriptHash({ command: "pnpm install " }),
    );
  });
});

describe("isWorktreeSetupStale", () => {
  const worktree = { worktreePath: "/tmp/worktrees/one" };

  it("compares the recorded setup with the project's current setup script", () => {
    const scripts = [setup];
    expect(
      isWorktreeSetupStale({ ...worktree, setupScriptHash: projectScriptHash(setup) }, scripts),
    ).toBe(false);
    expect(
      isWorktreeSetupStale(
        { ...worktree, setupScriptHash: projectScriptHash({ command: "npm install" }) },
        scripts,
      ),
    ).toBe(true);
  });

  it("only looks at the script that runs on worktree creation", () => {
    const build: ProjectScript = {
      ...setup,
      id: "build",
      command: "pnpm build",
      runOnWorktreeCreate: false,
    };
    const recorded = { ...worktree, setupScriptHash: projectScriptHash(setup) };
    expect(isWorktreeSetupStale(recorded, [build, setup])).toBe(false);
    expect(isWorktreeSetupStale(recorded, [build])).toBe(false);
  });

  it("has nothing to compare without a worktree or a recorded setup", () => {
    const stale = projectScriptHash({ command: "npm install" });
    expect(isWorktreeSetupStale({ worktreePath: null, setupScriptHash: stale }, [setup])).toBe(
      false,
    );
    expect(isWorktreeSetupStale({ ...worktree, setupScriptHash: null }, [setup])).toBe(false);
    expect(isWorktreeSetupStale(worktree, [setup])).toBe(false);
  });
});
