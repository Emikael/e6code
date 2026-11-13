import { CheckpointRef, TurnId } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "../../session-logic";
import type { TurnDiffSummary } from "../../types";
import { deriveThreadArtifacts } from "./threadArtifacts";

const turn1 = TurnId.make("turn-1");
const turn2 = TurnId.make("turn-2");
const page = { attachmentId: "thread-1-aaaa-html", title: "Chart", height: 300 };

const render = (id: string, createdAt: string): WorkLogEntry => ({
  id,
  createdAt,
  turnId: turn1,
  label: "Render HTML",
  tone: "tool",
  htmlRender: page,
});

const summary = (
  turnId: TurnId,
  completedAt: string,
  files: TurnDiffSummary["files"],
): TurnDiffSummary =>
  ({
    turnId,
    checkpointTurnCount: 1,
    checkpointRef: CheckpointRef.make(`ref-${turnId}`),
    status: "ready",
    files,
    completedAt,
  }) as TurnDiffSummary;

const file = (path: string, additions = 1, deletions = 0) => ({
  path,
  kind: "modified",
  additions,
  deletions,
});

describe("deriveThreadArtifacts", () => {
  it("lists pages once and viewable changed files at their latest change, newest first", () => {
    const artifacts = deriveThreadArtifacts({
      workEntries: [render("a", "2026-01-01T00:00:01Z"), render("a-again", "2026-01-01T00:00:02Z")],
      turnDiffSummaries: [
        summary(turn1, "2026-01-01T00:00:05Z", [file("report.html"), file("src/index.ts")]),
        summary(turn2, "2026-01-01T00:00:09Z", [file("report.html"), file("img/logo.PNG", 0, 0)]),
      ],
    });
    expect(
      artifacts.map((artifact) => [artifact.kind, artifact.title, artifact.createdAt]),
    ).toEqual([
      ["file", "report.html", "2026-01-01T00:00:09Z"],
      ["file", "logo.PNG", "2026-01-01T00:00:09Z"],
      ["page", "Chart", "2026-01-01T00:00:01Z"],
    ]);
  });

  it("skips files that only lost lines", () => {
    const artifacts = deriveThreadArtifacts({
      workEntries: [],
      turnDiffSummaries: [summary(turn1, "2026-01-01T00:00:05Z", [file("old.html", 0, 12)])],
    });
    expect(artifacts).toEqual([]);
  });
});
