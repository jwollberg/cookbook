/**
 * Cloudflare D1's API over a SQLite file, so the app's queries run unchanged on Vault.
 *
 * D1 is SQLite behind an async API; this is that API over Node's own SQLite (`node:sqlite`),
 * as much of it as the Atheos apps use: prepare / bind / first / all / run, and batch (one
 * transaction). Values bind as D1 binds them: a boolean becomes 1 or 0, and undefined is an
 * error. Opening the file applies the app's `migrations/*.sql` that it has not applied yet,
 * recorded in `d1_migrations` as wrangler records them, so a database exported from D1
 * carries its history with it.
 *
 * Canonical copy: Website-Home `vault/app-platform/d1.ts`; each app carries a copy
 * (Home's `vault/README.md`).
 */

import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

type SqlValue = string | number | bigint | null | Uint8Array;

export interface D1Meta {
  changes: number;
  last_row_id: number;
  duration: number;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: true;
  meta: D1Meta;
}

function toSqlValue(value: unknown, index: number): SqlValue {
  if (value === undefined) throw new TypeError(`D1_TYPE_ERROR: undefined bound at position ${index + 1}`);
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(`D1_TYPE_ERROR: ${typeof value} bound at position ${index + 1}`);
}

export class D1PreparedStatement {
  constructor(
    private readonly db: D1Database,
    readonly sql: string,
    private readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new D1PreparedStatement(this.db, this.sql, values.map(toSqlValue));
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.execute().results[0];
    if (row === undefined) return null;
    if (column === undefined) return row as T;
    if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: ${column}`);
    return (row as Record<string, unknown>)[column] as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.execute() as D1Result<T>;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.execute() as D1Result<T>;
  }

  /** @internal Runs the statement now; batch calls it inside its transaction. */
  execute(): D1Result {
    const started = performance.now();
    const statement = this.db.statement(this.sql);
    let results: Record<string, unknown>[] = [];
    let changes = 0;
    let lastRowId = 0;
    if (statement.columns().length > 0) {
      // A reader: a SELECT, or a write with RETURNING, whose changes are the connection's
      // running total of changes across it.
      const before = this.db.totalChanges();
      results = statement.all(...this.params) as Record<string, unknown>[];
      changes = this.db.totalChanges() - before;
      if (changes > 0) lastRowId = this.db.lastRowId();
    } else {
      const outcome = statement.run(...this.params);
      changes = Number(outcome.changes);
      lastRowId = Number(outcome.lastInsertRowid);
    }
    return {
      results,
      success: true,
      meta: { changes, last_row_id: lastRowId, duration: performance.now() - started },
    };
  }
}

export class D1Database {
  private readonly statements = new Map<string, StatementSync>();

  constructor(readonly sqlite: DatabaseSync) {}

  prepare(sql: string): D1PreparedStatement {
    return new D1PreparedStatement(this, sql);
  }

  /** Runs the statements in order in one transaction: all of them, or none if one fails. */
  async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((s) => s.execute() as D1Result<T>);
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    const started = performance.now();
    this.sqlite.exec(sql);
    return { count: sql.split(";").filter((s) => s.trim()).length, duration: performance.now() - started };
  }

  /** @internal */
  statement(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.sqlite.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  /** @internal */
  totalChanges(): number {
    return Number((this.statement("SELECT total_changes() AS n").get() as { n: number }).n);
  }

  /** @internal */
  lastRowId(): number {
    return Number((this.statement("SELECT last_insert_rowid() AS n").get() as { n: number }).n);
  }
}

/**
 * Opens (creating if need be) the SQLite file at `path` as D1 would serve it: foreign keys
 * enforced, write-ahead logging, a five-second wait on a lock, and every migration in
 * `migrationsDir` applied in name order, once each.
 */
export function openD1(path: string, migrationsDir: string): D1Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path);
  sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
  );
  const applied = new Set(
    (sqlite.prepare("SELECT name FROM d1_migrations").all() as { name: string }[]).map((r) => r.name),
  );
  const pending = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql") && !applied.has(name))
    .sort();
  for (const name of pending) {
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      sqlite.exec(readFileSync(join(migrationsDir, name), "utf8"));
      sqlite.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(name);
      sqlite.exec("COMMIT");
      console.log(`Applied migration ${name}`);
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw new Error(`Migration ${name} failed: ${error instanceof Error ? error.message : error}`);
    }
  }
  return new D1Database(sqlite);
}
