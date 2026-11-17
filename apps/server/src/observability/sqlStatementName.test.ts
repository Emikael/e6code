import { describe, expect, it } from "vite-plus/test";

import { normalizeSql, sqlStatementName, sqlStatementSample } from "./sqlStatementName.ts";

describe("sqlStatementName", () => {
  it("gives every IN-list arity the same name", () => {
    const one = sqlStatementName("SELECT * FROM projection_threads WHERE thread_id IN (?)");
    const three = sqlStatementName("SELECT * FROM projection_threads WHERE thread_id IN (?,?, ?)");
    expect(one).toBe(three);
    expect(one).toMatch(/^SELECT projection_threads#[0-9a-f]{6}$/);
  });

  it("collapses multi-row VALUES inserts", () => {
    expect(sqlStatementName("INSERT INTO projection_state (a, b) VALUES (?,?)")).toBe(
      sqlStatementName("INSERT INTO projection_state (a, b) VALUES (?,?),(?,?),(?,?)"),
    );
    expect(sqlStatementName("INSERT INTO projection_state (a) VALUES (?)")).toMatch(
      /^INSERT projection_state#/,
    );
  });

  it("ignores whitespace, comments and literal values", () => {
    expect(
      sqlStatementName(`
        -- latest rows
        SELECT id FROM t /* block */ WHERE kind = 'a' LIMIT 50
      `),
    ).toBe(sqlStatementName("SELECT id FROM t WHERE kind = 'b''c' LIMIT 10"));
  });

  it("tells different queries on one table apart", () => {
    expect(sqlStatementName("SELECT a FROM t WHERE id = ?")).not.toBe(
      sqlStatementName("SELECT b FROM t WHERE id = ?"),
    );
  });

  it("names the verb and table for each statement kind", () => {
    expect(sqlStatementName("UPDATE projection_threads SET title = ? WHERE id = ?")).toMatch(
      /^UPDATE projection_threads#/,
    );
    expect(sqlStatementName("DELETE FROM auth_sessions WHERE id = ?")).toMatch(
      /^DELETE auth_sessions#/,
    );
    expect(sqlStatementName('INSERT OR REPLACE INTO "kv" (k) VALUES (?)')).toMatch(/^INSERT kv#/);
    expect(sqlStatementName("WITH recent AS (SELECT * FROM events) SELECT * FROM recent")).toMatch(
      /^WITH events#/,
    );
  });

  it("names transaction control by verb so savepoint counters do not add names", () => {
    expect(sqlStatementName("BEGIN")).toBe("BEGIN");
    expect(sqlStatementName("COMMIT")).toBe("COMMIT");
    expect(sqlStatementName("SAVEPOINT effect_sql_1")).toBe("SAVEPOINT");
    expect(sqlStatementName("SAVEPOINT effect_sql_42")).toBe("SAVEPOINT");
    expect(sqlStatementName("ROLLBACK TO SAVEPOINT effect_sql_42")).toBe("ROLLBACK");
    expect(sqlStatementName("RELEASE SAVEPOINT effect_sql_42")).toBe("RELEASE");
  });

  it("names schema changes by kind so migrations add only a few names", () => {
    expect(sqlStatementName("CREATE TABLE IF NOT EXISTS projection_threads (id TEXT)")).toBe(
      "CREATE TABLE",
    );
    expect(sqlStatementName("CREATE UNIQUE INDEX idx_a ON t(a)")).toBe("CREATE INDEX");
    expect(sqlStatementName("ALTER TABLE projection_threads ADD COLUMN x TEXT")).toBe(
      "ALTER TABLE",
    );
    expect(sqlStatementName("DROP INDEX IF EXISTS idx_a")).toBe("DROP INDEX");
  });

  it("names pragmas by pragma without the value", () => {
    expect(sqlStatementName("PRAGMA busy_timeout = 5000")).toBe("PRAGMA busy_timeout");
    expect(sqlStatementName("pragma journal_mode")).toBe("PRAGMA journal_mode");
  });

  it("keeps identifiers that contain digits intact", () => {
    expect(normalizeSql("SELECT v2 FROM table_3 WHERE x = 7")).toBe(
      "SELECT v2 FROM table_3 WHERE x = ?",
    );
  });
});

describe("sqlStatementSample", () => {
  it("shortens long SQL with an ellipsis", () => {
    const sample = sqlStatementSample(`SELECT ${"a, ".repeat(100)}b FROM t`, 40);
    expect(sample).toHaveLength(40);
    expect(sample.endsWith("…")).toBe(true);
  });
});
