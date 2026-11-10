import { EventId, ThreadId } from "@e6tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionThreadActivityRepository } from "../Services/ProjectionThreadActivities.ts";
import { ProjectionThreadActivityRepositoryLive } from "./ProjectionThreadActivities.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ProjectionThreadActivityRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProjectionThreadActivityRepository", (it) => {
  it.effect("reads only the latest matching task activity", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadActivityRepository;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.make("thread-latest-task-activity");

      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
        )
        VALUES
          (
            'activity-task-unrelated-tool', ${threadId}, NULL, 'tool', 'tool.completed',
            'large tool output', 'not-json', 1, '2026-03-01T00:00:00.000Z'
          ),
          (
            'activity-task-started', ${threadId}, NULL, 'info', 'task.started',
            'started', '{"taskId":"task-1","title":"Initial title"}', 2,
            '2026-03-01T00:00:01.000Z'
          ),
          (
            'activity-task-progress', ${threadId}, NULL, 'info', 'task.progress',
            'progress', '{"taskId":"task-1","title":"Updated title"}', 3,
            '2026-03-01T00:00:02.000Z'
          ),
          (
            'activity-task-other', ${threadId}, NULL, 'info', 'task.progress',
            'other', '{"taskId":"task-2","title":"Other title"}', 4,
            '2026-03-01T00:00:03.000Z'
          )
      `;

      yield* repository.upsert({
        activityId: EventId.make("activity-task-untitled"),
        threadId,
        turnId: null,
        tone: "info",
        kind: "task.progress",
        summary: "Still running",
        payload: { taskId: "task-1" },
        sequence: 5,
        createdAt: "2026-03-01T00:00:04.000Z",
      });
      yield* repository.upsert({
        activityId: EventId.make("activity-task-blank-title"),
        threadId,
        turnId: null,
        tone: "info",
        kind: "task.progress",
        summary: "Still running",
        payload: { taskId: "task-1", title: " \t\n\u00a0" },
        sequence: 6,
        createdAt: "2026-03-01T00:00:05.000Z",
      });

      const recent = yield* repository.listByThreadId({
        threadId,
        activityKinds: ["task.progress"],
        limit: 2,
      });
      assert.deepEqual(
        recent.map((entry) => entry.activityId),
        ["activity-task-untitled", "activity-task-blank-title"],
      );

      const activity = yield* repository.getLatestTaskActivity({
        threadId,
        taskId: "task-1",
      });
      assert.equal(activity._tag, "Some");
      if (activity._tag === "Some") {
        assert.equal(activity.value.activityId, EventId.make("activity-task-progress"));
        assert.deepEqual(activity.value.payload, {
          taskId: "task-1",
          title: "Updated title",
        });
      }

      assert.equal(
        (yield* repository.getLatestTaskActivity({ threadId, taskId: "missing" }))._tag,
        "None",
      );
    }),
  );

  it.effect("keeps the thread usage total in step with turn.usage upserts", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadActivityRepository;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.make("thread-usage-totals");
      const upsertUsage = (turn: number, payload: unknown) =>
        repository.upsert({
          activityId: EventId.make(`usage-${turn}`),
          threadId,
          turnId: null,
          tone: "info",
          kind: "turn.usage",
          summary: "Usage",
          payload,
          sequence: turn,
          createdAt: "2026-03-01T00:00:00.000Z",
        });
      const readTotal = sql<{
        readonly turnCount: number;
        readonly totalTokens: number | null;
        readonly costUsd: number | null;
        readonly costedTurnCount: number;
        readonly estimatedTurnCount: number;
      }>`
        SELECT
          turn_count AS "turnCount",
          total_tokens AS "totalTokens",
          cost_usd AS "costUsd",
          costed_turn_count AS "costedTurnCount",
          estimated_turn_count AS "estimatedTurnCount"
        FROM projection_thread_usage_totals
        WHERE thread_id = ${threadId}
      `;

      yield* upsertUsage(1, { totalTokens: 100, costUsd: 0.5, costSource: "reported" });
      // Other kinds do not touch the total.
      yield* repository.upsert({
        activityId: EventId.make("usage-tool"),
        threadId,
        turnId: null,
        tone: "tool",
        kind: "tool.completed",
        summary: "Tool",
        payload: { totalTokens: 9999 },
        sequence: 2,
        createdAt: "2026-03-01T00:00:00.000Z",
      });
      assert.deepEqual(yield* readTotal, [
        { turnCount: 1, totalTokens: 100, costUsd: 0.5, costedTurnCount: 1, estimatedTurnCount: 0 },
      ]);

      // A new turn adds to the total.
      yield* upsertUsage(3, { totalTokens: 50, costUsd: 0.25, costSource: "estimated" });
      assert.deepEqual(yield* readTotal, [
        {
          turnCount: 2,
          totalTokens: 150,
          costUsd: 0.75,
          costedTurnCount: 2,
          estimatedTurnCount: 1,
        },
      ]);

      // Re-upserting a turn replaces its contribution instead of adding it again.
      yield* upsertUsage(3, { totalTokens: 70 });
      assert.deepEqual(yield* readTotal, [
        { turnCount: 2, totalTokens: 170, costUsd: 0.5, costedTurnCount: 1, estimatedTurnCount: 0 },
      ]);

      yield* repository.deleteByThreadId({ threadId });
      assert.deepEqual(yield* readTotal, []);
    }),
  );
});
