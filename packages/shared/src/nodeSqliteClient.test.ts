import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as SqliteClient from "./nodeSqliteClient.ts";

const layer = it.layer(SqliteClient.layer({ filename: ":memory:" }));

layer("NodeSqliteClient", (it) => {
  it.effect("runs prepared queries and returns positional values", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`CREATE TABLE entries(id INTEGER PRIMARY KEY, name TEXT NOT NULL)`;
      yield* sql`INSERT INTO entries(name) VALUES (${"alpha"}), (${"beta"})`;

      const rows = yield* sql<{ readonly id: number; readonly name: string }>`
      SELECT id, name FROM entries ORDER BY id
    `;
      assert.equal(rows.length, 2);
      assert.equal(rows[0]?.name, "alpha");
      assert.equal(rows[1]?.name, "beta");

      const values = yield* sql`SELECT id, name FROM entries ORDER BY id`.values;
      assert.equal(values.length, 2);
      assert.equal(values[0]?.[1], "alpha");
      assert.equal(values[1]?.[1], "beta");

      const unpreparedValues = yield* sql`SELECT id, name FROM entries ORDER BY id`
        .valuesUnprepared;
      assert.deepEqual(unpreparedValues, values);
    }),
  );

  it.effect("returns a typed failure when an unprepared statement cannot be prepared", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const error = yield* Effect.flip(sql.unsafe("SELECT FROM").unprepared);

      assert.equal(error._tag, "SqlError");
      assert.equal(error.reason.operation, "prepare");
    }),
  );
});

it.effect("returns a typed failure when the database cannot be opened", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(
      Layer.build(SqliteClient.layer({ filename: "\0" })).pipe(Effect.scoped),
    );

    assert.equal(error._tag, "SqlError");
    assert.equal(error.reason.operation, "open");
  }),
);

it.effect("reports each prepared statement once and each execute with its outcome", () => {
  const registered: Array<string> = [];
  const recorded: Array<{
    readonly sql: string;
    readonly ok: boolean;
    readonly durationMs: number;
  }> = [];
  const observer: SqliteClient.SqliteStatementObserver<string> = {
    register: (sql) => {
      registered.push(sql);
      return sql;
    },
    record: (sql, durationMs, ok) => {
      recorded.push({ sql, ok, durationMs });
    },
  };

  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE entries(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)`;
    yield* sql`INSERT INTO entries(name) VALUES (${"alpha"})`;
    for (let index = 0; index < 3; index++) {
      yield* sql`SELECT id FROM entries WHERE name = ${"alpha"}`;
    }
    yield* sql`SELECT id, name FROM entries`.values;
    const failure = yield* Effect.flip(sql`INSERT INTO entries(name) VALUES (${"alpha"})`);
    assert.equal(failure._tag, "SqlError");

    const select = "SELECT id FROM entries WHERE name = ?";
    assert.equal(registered.filter((text) => text === select).length, 1);
    assert.equal(recorded.filter((entry) => entry.sql === select).length, 3);
    assert.isTrue(recorded.some((entry) => entry.sql === "SELECT id, name FROM entries"));
    const inserts = recorded.filter((entry) => entry.sql.startsWith("INSERT INTO entries"));
    assert.deepEqual(
      inserts.map((entry) => entry.ok),
      [true, false],
    );
    assert.isTrue(recorded.every((entry) => entry.durationMs >= 0));
  }).pipe(
    Effect.provide(SqliteClient.layer({ filename: ":memory:", statementObserver: observer })),
  );
});
