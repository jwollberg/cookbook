import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openD1, type D1Database } from "./d1";

let dir: string;
let db: D1Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "d1-"));
  const migrations = join(dir, "migrations");
  mkdirSync(migrations);
  writeFileSync(join(migrations, "0001_init.sql"), "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, flag INTEGER);");
  writeFileSync(join(migrations, "0002_more.sql"), "ALTER TABLE t ADD COLUMN note TEXT;");
  db = openD1(join(dir, "app.sqlite"), migrations);
});

afterEach(() => {
  db.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("openD1", () => {
  it("applies each migration once, recorded as wrangler records them", async () => {
    const names = await db.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{ name: string }>();
    expect(names.results.map((r) => r.name)).toEqual(["0001_init.sql", "0002_more.sql"]);
    db.sqlite.close();
    db = openD1(join(dir, "app.sqlite"), join(dir, "migrations"));
    expect((await db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first<{ n: number }>())?.n).toBe(2);
  });
});

describe("statements", () => {
  it("binds, writes and reads as D1 does", async () => {
    const insert = await db.prepare("INSERT INTO t (name, flag) VALUES (?, ?)").bind("a", true).run();
    expect(insert.meta.changes).toBe(1);
    expect(insert.meta.last_row_id).toBe(1);
    await db.prepare("INSERT INTO t (name, flag) VALUES (?, ?)").bind("b", false).run();
    const rows = await db.prepare("SELECT name, flag FROM t ORDER BY id").all<{ name: string; flag: number }>();
    expect(rows.results).toEqual([
      { name: "a", flag: 1 },
      { name: "b", flag: 0 },
    ]);
    expect(rows.meta.changes).toBe(0);
    expect(await db.prepare("SELECT name FROM t WHERE id = ?").bind(2).first<{ name: string }>()).toEqual({ name: "b" });
    expect(await db.prepare("SELECT name FROM t WHERE id = ?").bind(2).first<string>("name")).toBe("b");
    expect(await db.prepare("SELECT name FROM t WHERE id = ?").bind(9).first()).toBeNull();
  });

  it("counts the changes of a write that returns rows", async () => {
    await db.prepare("INSERT INTO t (name) VALUES ('a'), ('b')").run();
    const updated = await db.prepare("UPDATE t SET note = 'x' RETURNING id").all<{ id: number }>();
    expect(updated.results).toHaveLength(2);
    expect(updated.meta.changes).toBe(2);
  });

  it("refuses undefined, as D1 does", () => {
    expect(() => db.prepare("SELECT ?").bind(undefined)).toThrow(/D1_TYPE_ERROR/);
  });
});

describe("batch", () => {
  it("commits every statement together", async () => {
    const results = await db.batch([
      db.prepare("INSERT INTO t (name) VALUES (?)").bind("a"),
      db.prepare("INSERT INTO t (name) VALUES (?)").bind("b"),
      db.prepare("SELECT COUNT(*) AS n FROM t"),
    ]);
    expect(results[2].results).toEqual([{ n: 2 }]);
  });

  it("rolls every statement back when one fails", async () => {
    await expect(
      db.batch([db.prepare("INSERT INTO t (name) VALUES (?)").bind("a"), db.prepare("INSERT INTO t (name) VALUES (NULL)")]),
    ).rejects.toThrow();
    expect((await db.prepare("SELECT COUNT(*) AS n FROM t").first<{ n: number }>())?.n).toBe(0);
  });
});
