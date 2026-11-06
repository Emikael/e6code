import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_messages)
  `;

  if (!columns.some((column) => column.name === "split_into_subagents")) {
    yield* sql`
      ALTER TABLE projection_thread_messages
      ADD COLUMN split_into_subagents INTEGER NOT NULL DEFAULT 0
    `;
  }
});
