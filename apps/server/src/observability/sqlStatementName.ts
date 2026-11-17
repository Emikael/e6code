/**
 * Stable, low-cardinality names for SQLite statements, used as the key for
 * statement timings. Computed once per distinct SQL text, never per execute.
 *
 * The name is `VERB table#hash`, for example `SELECT projection_threads#3fa2c1`.
 * The hash covers the normalised SQL, so two different queries on one table get
 * different names while `IN (?)` and `IN (?,?,?)` (from `sql.in`) or multi-row
 * `VALUES` inserts collapse to one. Transaction control statements are named by
 * their verb alone because savepoint names carry a counter, and schema changes
 * by their kind (`CREATE INDEX`).
 */

const TRANSACTION_CONTROL = /^(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/;
// Schema changes run once, mostly in migrations; naming them by kind keeps a
// fresh database's migrations from using up the statement-name limit.
const SCHEMA_CHANGE =
  /^(CREATE|ALTER|DROP)\s+(?:UNIQUE\s+|TEMP\s+|TEMPORARY\s+|VIRTUAL\s+)?(TABLE|INDEX|VIEW|TRIGGER)\b/;
const TABLE_AFTER_KEYWORD: Readonly<Record<string, RegExp>> = {
  SELECT: /\bFROM\s+([A-Za-z_][\w.]*|"[^"]+")/,
  DELETE: /\bFROM\s+([A-Za-z_][\w.]*|"[^"]+")/,
  INSERT: /\bINTO\s+([A-Za-z_][\w.]*|"[^"]+")/,
  REPLACE: /\bINTO\s+([A-Za-z_][\w.]*|"[^"]+")/,
  UPDATE: /^UPDATE\s+(?:OR\s+\w+\s+)?([A-Za-z_][\w.]*|"[^"]+")/,
};

export function normalizeSql(sql: string): string {
  return (
    sql
      .replace(/--[^\n]*/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/'(?:[^']|'')*'/g, "?")
      .replace(/\b\d+(?:\.\d+)?\b/g, "?")
      .replace(/\s+/g, " ")
      .trim()
      // `(?)`, `(?, ?, ?)` from `sql.in` and value tuples all become `(?+)`.
      .replace(/\(\s*\?(?:\s*,\s*\?)*\s*\)/g, "(?+)")
      // Multi-row `VALUES (?+), (?+)` inserts collapse to one tuple.
      .replace(/\(\?\+\)(?:\s*,\s*\(\?\+\))+/g, "(?+)")
  );
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 6);
}

export function sqlStatementName(sql: string): string {
  const normalized = normalizeSql(sql);
  const upper = normalized.toUpperCase();
  const control = TRANSACTION_CONTROL.exec(upper);
  if (control) return control[1]!;
  const schemaChange = SCHEMA_CHANGE.exec(upper);
  if (schemaChange) return `${schemaChange[1]} ${schemaChange[2]}`;

  const verb = /^[A-Z]+/.exec(upper)?.[0] ?? "SQL";
  if (verb === "PRAGMA") {
    const pragma = /^PRAGMA\s+([\w.]+)/i.exec(normalized)?.[1];
    return pragma ? `PRAGMA ${pragma}` : "PRAGMA";
  }

  // A CTE's main verb follows the CTE bodies; the hash still tells them apart.
  const tablePattern = TABLE_AFTER_KEYWORD[verb === "WITH" ? "SELECT" : verb];
  const table = tablePattern?.exec(normalized)?.[1]?.replaceAll('"', "");
  return `${verb}${table ? ` ${table}` : ""}#${fnv1a(normalized)}`;
}

/** Short display form of the SQL a name stands for. */
export function sqlStatementSample(sql: string, maxLength = 160): string {
  const normalized = normalizeSql(sql);
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}
