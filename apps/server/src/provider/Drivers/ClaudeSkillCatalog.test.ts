import { describe, expect, it } from "vite-plus/test";
import {
  classifyClaudeNativeSkills,
  mergeClaudeSkillCatalog,
  resolveClaudeNativeSkills,
} from "./ClaudeSkills.ts";

describe("Claude native skill catalog", () => {
  const disk = [
    { name: "review", path: "/workspace/.claude/skills/review/SKILL.md", enabled: true },
  ];
  it("offers namespaced native skills without inventing source paths", () => {
    expect(
      mergeClaudeSkillCatalog(disk, [
        { name: "plugin:review", description: "Plugin review" },
        { name: "review" },
      ]),
    ).toEqual([{ name: "plugin:review", description: "Plugin review", enabled: true }, disk[0]]);
  });
  it("keeps a successful empty inventory empty and falls back only when native discovery is unavailable", () => {
    expect(mergeClaudeSkillCatalog(disk, [])).toEqual([]);
    expect(mergeClaudeSkillCatalog(disk, undefined)).toEqual(disk);
  });
  it("preserves provider restrictions and first native definition", () => {
    expect(
      mergeClaudeSkillCatalog(
        [{ name: "release", enabled: false, userInvocable: false }],
        [
          { name: "release", description: "First" },
          { name: "release", description: "Duplicate" },
        ],
      ),
    ).toEqual([{ name: "release", enabled: false, userInvocable: false, description: "First" }]);
  });
});

describe("Claude native skill classification", () => {
  const commands = [
    { name: "plugin:review", description: "Plugin review" },
    { name: "commit-commands:commit", description: "Create a commit" },
    { name: "simplify", description: "Simplify code", builtin: true },
    { name: "batch", description: "Batch changes", builtin: true },
    { name: "clear", description: "Clear the session", builtin: true },
    { name: "server:prompt (MCP)", description: "An MCP prompt" },
  ];
  const dialog = [{ name: "plugin:review", description: "Plugin review", scope: "plugin" }];

  it("keeps dialog rows, non-built-in commands and model-invocable built-ins as skills", () => {
    const inventory = classifyClaudeNativeSkills({
      commands,
      dialog,
      modelSkillNames: new Set(["simplify", "commit-commands:commit"]),
    });
    expect(inventory?.skills.map((skill) => skill.name)).toEqual([
      "plugin:review",
      "commit-commands:commit",
      "simplify",
    ]);
    expect(inventory?.builtinCandidates.map((skill) => skill.name)).toEqual(["batch", "clear"]);
  });

  it("admits a built-in only after a session names it among its skills", () => {
    const inventory = classifyClaudeNativeSkills({ commands, dialog, modelSkillNames: new Set() });
    const names = (sessionSkills: ReadonlySet<string>) =>
      resolveClaudeNativeSkills(inventory, sessionSkills)?.map((skill) => skill.name);
    expect(names(new Set())).not.toContain("batch");
    expect(names(new Set(["batch"]))).toContain("batch");
    expect(names(new Set(["batch"]))).not.toContain("clear");
  });

  it("does not trust command flags from CLIs without the skills dialog", () => {
    expect(
      classifyClaudeNativeSkills({ commands, dialog: undefined, modelSkillNames: undefined }),
    ).toBeUndefined();
    expect(resolveClaudeNativeSkills(undefined, new Set(["batch"]))).toBeUndefined();
  });
});
