import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import { isUnsafeGitOperand, isUnsafeGitPath } from "./gitRefSafety.ts";

const TestLayer = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "e6-git-ref-safety-" })),
  Layer.provideMerge(NodeServices.layer),
);

describe("git ref syntax", () => {
  it("rejects option-shaped revisions before git sees them", () => {
    assert.isTrue(isUnsafeGitOperand("--upload-pack=touch /tmp/x"));
    assert.isTrue(isUnsafeGitOperand("-b evil"));
    assert.isTrue(isUnsafeGitOperand("-b"));
    assert.isTrue(isUnsafeGitOperand("origin/-b"));
    assert.isFalse(isUnsafeGitOperand("feature/safe"));
    assert.isFalse(isUnsafeGitOperand("HEAD"));
    assert.isFalse(isUnsafeGitPath("/tmp/work tree"));
    assert.isTrue(isUnsafeGitPath("--upload-pack"));
  });
});

const initRepo = Effect.fn("initRepo")(function* (cwd: string) {
  const driver = yield* GitVcsDriver.GitVcsDriver;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* driver.initRepo({ cwd });
  yield* driver.execute({
    operation: "gitRefSafety.config",
    cwd,
    args: ["config", "user.email", "test@test.com"],
    timeoutMs: 10_000,
  });
  yield* driver.execute({
    operation: "gitRefSafety.config",
    cwd,
    args: ["config", "user.name", "Test"],
    timeoutMs: 10_000,
  });
  yield* fileSystem.writeFileString(path.join(cwd, "README.md"), "# test\n");
  yield* driver.execute({
    operation: "gitRefSafety.add",
    cwd,
    args: ["add", "."],
    timeoutMs: 10_000,
  });
  yield* driver.execute({
    operation: "gitRefSafety.commit",
    cwd,
    args: ["commit", "-m", "initial"],
    timeoutMs: 10_000,
  });
});

describe("git ref option injection", () => {
  it.effect("treats option-shaped names as refs and rejects them", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "e6-git-ref-safety-" });
      const driver = yield* GitVcsDriver.GitVcsDriver;
      yield* initRepo(cwd);
      const marker = path.join(cwd, "should-not-be-created");
      const evil = `--upload-pack=touch ${marker}`;

      const created = yield* driver.createRef({ cwd, refName: "feature/safe" });
      assert.equal(created.refName, "feature/safe");

      const optionRef = yield* driver.createRef({ cwd, refName: evil }).pipe(Effect.result);
      const dashed = yield* driver.createRef({ cwd, refName: "-b evil" }).pipe(Effect.result);
      const switched = yield* driver.switchRef({ cwd, refName: evil }).pipe(Effect.result);
      const worktree = yield* driver
        .createWorktree({ cwd, refName: "feature/safe", newRefName: "-b", path: null })
        .pipe(Effect.result);

      assert.equal(optionRef._tag, "Failure");
      assert.equal(dashed._tag, "Failure");
      assert.equal(switched._tag, "Failure");
      assert.equal(worktree._tag, "Failure");
      assert.isFalse(yield* fileSystem.exists(marker));

      const branches = yield* driver.execute({
        operation: "gitRefSafety.branches",
        cwd,
        args: ["branch", "--list"],
        timeoutMs: 10_000,
      });
      assert.notInclude(branches.stdout, "evil");
      assert.include(branches.stdout, "feature/safe");
    }).pipe(Effect.provide(TestLayer), Effect.scoped),
  );
});
