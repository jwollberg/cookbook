/**
 * Recipes shared, planning per person. Everything here runs against a real SQLite
 * database built from migrations/, the way the server opens it, with the starter
 * library from seed/ in it.
 */

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openD1, type D1Database } from "./d1";
import {
  forgetPerson,
  kitchenName,
  loadLibrary,
  loadPlan,
  loadPlanning,
  loadShoppingState,
  mutateShopping,
  savePlan,
  setTick,
  upsertUser,
  userForEmail,
  type Viewer,
} from "./db";
import { kitchenGlance } from "./glance";
import { applyListEdit } from "../list";
import type { MealPlan } from "../schema";
import { PUT as putPlan } from "../../pages/api/plans/[id]";
import { GET as getList, POST as postList } from "../../pages/api/shopping";
import { POST as glanceRoute } from "../../pages/internal/glance";
import { POST as forgetRoute } from "../../pages/internal/forget";
import { POST as createItem } from "../../pages/api/ingredients/index";

const MIGRATIONS = join(process.cwd(), "migrations");
const SEED = join(process.cwd(), "seed");
const STAMP = "2026-10-01T12:00:00.000Z";

let dir: string;
let db: D1Database;

/** A fresh database file with the named migrations applied (all of them by default). */
function openWith(names = readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql"))): D1Database {
  const migrations = join(dir, "migrations");
  mkdirSync(migrations, { recursive: true });
  for (const name of names) copyFileSync(join(MIGRATIONS, name), join(migrations, name));
  return openD1(join(dir, "app.sqlite"), migrations);
}

function seedLibrary(target: D1Database, by: string | null = null) {
  const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  const put = (table: string, doc: { id: string }) =>
    target.sqlite
      .prepare(`INSERT INTO ${table} (id, data, updated_at, updated_by) VALUES (?, ?, ?, ?)`)
      .run(doc.id, JSON.stringify(doc), STAMP, by);
  for (const i of read(join(SEED, "ingredients.json"))) put("ingredients", i);
  for (const f of readdirSync(join(SEED, "recipes"))) put("recipes", read(join(SEED, "recipes", f)));
  for (const f of readdirSync(join(SEED, "meals"))) put("meals", read(join(SEED, "meals", f)));
}

const week = (start: string, entries: { date: string; recipeId?: string; mealId?: string }[]): MealPlan => ({
  id: `week-${start}`,
  name: `Week of ${start}`,
  days: entries.map(({ date, ...ref }) => ({ date, entries: [{ slot: "dinner", ...ref }] })),
});

/** What an API route sees: the request plus the locals the middleware sets. */
function call(
  route: (context: never) => Response | Promise<Response>,
  viewer: Viewer | null,
  request: Request,
  params: Record<string, string> = {},
  env: Partial<Env> = {},
): Promise<Response> {
  const context = {
    request,
    params,
    url: new URL(request.url),
    locals: { viewer, runtime: { env: { DB: db, ...env }, cf: {}, ctx: { waitUntil() {} } } },
  };
  return Promise.resolve(route(context as never));
}

const post = (path: string, body: unknown) =>
  new Request(`https://kitchen.test${path}`, { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kitchen-"));
});

afterEach(() => {
  db?.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("recipes shared, planning per person", () => {
  let josh: Viewer;
  let reagen: Viewer;

  beforeEach(async () => {
    db = openWith();
    seedLibrary(db);
    josh = await upsertUser(db, { id: "google-sub-josh", email: "josh.wollberg@gmail.com", name: "Josh Wollberg" });
    reagen = await userForEmail(db, "reagenbrase@gmail.com");
    await savePlan(db, josh.id, week("2026-10-11", [{ date: "2026-10-12", recipeId: "falafel" }]));
    await mutateShopping(db, josh.id, (l) => applyListEdit(l, { type: "addDish", dish: { recipeId: "potato-soup" } }));
    await setTick(db, josh.id, "ingredient:tomato", true);
  });

  it("gives a second person every recipe, an empty week and an empty list", async () => {
    const [mine, hers] = await Promise.all([loadLibrary(db), loadLibrary(db)]);
    expect(hers.recipes.length).toBeGreaterThan(30);
    expect(hers).toEqual(mine);

    const planning = await loadPlanning(db, reagen.id);
    expect(planning.plans).toEqual([]);
    expect(planning.shopping.dishes).toEqual([]);
    expect(planning.ticked).toEqual([]);
    expect(await loadPlan(db, reagen.id, "week-2026-10-11")).toBeNull();
  });

  it("keeps each person's writes to themselves", async () => {
    await savePlan(db, reagen.id, week("2026-10-11", [{ date: "2026-10-13", mealId: "greek-dinner" }]));
    await setTick(db, reagen.id, "ingredient:lemon", true);

    const joshs = await loadPlanning(db, josh.id);
    expect(joshs.plans).toHaveLength(1);
    expect(joshs.plans[0].days[0].entries[0].recipeId).toBe("falafel");
    expect(joshs.shopping.dishes).toEqual([{ recipeId: "potato-soup" }]);
    expect(joshs.ticked).toEqual(["ingredient:tomato"]);
    expect((await loadPlan(db, reagen.id, "week-2026-10-11"))?.days[0].entries[0].mealId).toBe("greek-dinner");
  });

  it("turns Monday weeks into Sunday weeks on disk, even one saved by a tab open from before", async () => {
    const ids = async () =>
      (await db.prepare("SELECT id FROM plans WHERE user_id = ? ORDER BY id").bind(reagen.id).all<{ id: string }>()).results.map((r) => r.id);
    // As stored before weeks began on Sunday: Monday the 5th to Sunday the 11th.
    await savePlan(db, reagen.id, week("2026-10-05", [{ date: "2026-10-06", recipeId: "falafel" }, { date: "2026-10-11", mealId: "greek-dinner" }]));
    const planning = await loadPlanning(db, reagen.id);
    expect(planning.plans.map((p) => p.id)).toEqual(["week-2026-10-11", "week-2026-10-04"]);
    expect(await ids()).toEqual(["week-2026-10-04", "week-2026-10-11"]);
    expect((await loadPlan(db, reagen.id, "week-2026-10-11"))?.days[0]).toEqual({
      date: "2026-10-11",
      entries: [{ slot: "dinner", mealId: "greek-dinner" }],
    });

    // A tab still on the old code saves its Monday week after the deploy: read again, it is folded in.
    await savePlan(db, reagen.id, week("2026-10-12", [{ date: "2026-10-13", recipeId: "potato-soup" }]));
    const glanced = await loadPlan(db, reagen.id, "week-2026-10-11");
    expect(glanced?.days.find((d) => d.date === "2026-10-13")?.entries[0].recipeId).toBe("potato-soup");
    expect(await ids()).toEqual(["week-2026-10-04", "week-2026-10-11"]);
    // Josh's week is untouched by Reagen's.
    expect((await loadPlanning(db, josh.id)).plans.map((p) => p.id)).toEqual(["week-2026-10-11"]);
  });

  it("finds a person by address however Gmail spells it, and never splits them in two", async () => {
    expect((await userForEmail(db, "Josh.Wollberg+food@gmail.com")).id).toBe(josh.id);
    expect((await userForEmail(db, "REAGENBRASE@googlemail.com")).id).toBe(reagen.id);
  });

  it("answers 404 from the plan route for a week named as someone else's", async () => {
    const theirs = week("2026-10-11", [{ date: "2026-10-12", recipeId: "deviled-eggs" }]);
    const request = new Request("https://kitchen.test/api/plans/week-2026-10-11", {
      method: "PUT",
      body: JSON.stringify({ owner: josh.id, plan: theirs }),
    });
    const res = await call(putPlan, reagen, request, { id: theirs.id });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found — reload the page." });
    expect((await loadPlan(db, josh.id, theirs.id))?.days[0].entries[0].recipeId).toBe("falafel");
    expect(await loadPlan(db, reagen.id, theirs.id)).toBeNull();

    // Her own owner id saves to her own week, and Josh's is still his.
    const mine = new Request(request.url, { method: "PUT", body: JSON.stringify({ owner: reagen.id, plan: theirs }) });
    expect((await call(putPlan, reagen, mine, { id: theirs.id })).status).toBe(200);
    expect((await loadPlan(db, reagen.id, theirs.id))?.days[0].entries[0].recipeId).toBe("deviled-eggs");
    expect((await loadPlan(db, josh.id, theirs.id))?.days[0].entries[0].recipeId).toBe("falafel");
  });

  it("answers 404 from the list route for someone else's list, read or written", async () => {
    const read = (owner: string) => call(getList, reagen, new Request(`https://kitchen.test/api/shopping?owner=${owner}`));
    expect((await read(josh.id)).status).toBe(404);
    expect((await call(getList, reagen, new Request("https://kitchen.test/api/shopping"))).status).toBe(404);
    const own = await read(reagen.id);
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ extras: { dishes: [], items: [] }, ticked: [] });

    for (const edit of [{ type: "clear" }, { type: "tick", key: "ingredient:tomato", on: false }]) {
      expect((await call(postList, reagen, post("/api/shopping", { owner: josh.id, edit }))).status).toBe(404);
    }
    const joshs = await loadShoppingState(db, josh.id);
    expect(joshs.extras.dishes).toEqual([{ recipeId: "potato-soup" }]);
    expect(joshs.ticked).toEqual(["ingredient:tomato"]);

    const added = await call(postList, reagen, post("/api/shopping", { owner: reagen.id, edit: { type: "addDish", dish: { mealId: "greek-dinner" } } }));
    expect((await added.json()).extras.dishes).toEqual([{ mealId: "greek-dinner" }]);
    expect((await loadShoppingState(db, josh.id)).extras.dishes).toEqual([{ recipeId: "potato-soup" }]);
  });
});

describe("Home's glance", () => {
  beforeEach(async () => {
    db = openWith();
    seedLibrary(db);
    const josh = await upsertUser(db, { id: "google-sub-josh", email: "josh.wollberg@gmail.com", name: "Josh Wollberg" });
    await savePlan(
      db,
      josh.id,
      week("2026-10-11", [
        { date: "2026-10-12", mealId: "greek-dinner" },
        { date: "2026-10-14", recipeId: "falafel" },
      ]),
    );
    await mutateShopping(db, josh.id, (l) => applyListEdit(l, { type: "addDish", dish: { recipeId: "potato-soup" } }));
    await upsertUser(db, { id: "r-1", email: "reagenbrase@gmail.com", name: null });
  });

  it("answers for the asker's own kitchen only", async () => {
    expect(await kitchenGlance({ DB: db } as Env, "JoshWollberg@gmail.com", "2026-10-12")).toEqual({
      kitchen: "Josh's kitchen",
      tonight: ["Greek Dinner"],
      plannedDays: 2,
      listCount: 1,
      aiCents: 0,
    });
    expect(await kitchenGlance({ DB: db } as Env, "reagenbrase@gmail.com", "2026-10-12")).toEqual({
      kitchen: "Reagenbrase's kitchen",
      tonight: [],
      plannedDays: 0,
      listCount: 0,
      aiCents: 0,
    });
  });

  it("gives someone who never signed in an empty week, and makes no row for them", async () => {
    const before = (await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())?.n;
    expect(await kitchenGlance({ DB: db } as Env, "gwenevere.greenwood@gmail.com", "2026-10-12")).toEqual({
      kitchen: "Gwenevere's kitchen",
      tonight: [],
      plannedDays: 0,
      listCount: 0,
      aiCents: 0,
    });
    expect((await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())?.n).toBe(before);
  });

  it("tells Home the asker's own AI spend this month, across every id their inbox has had", async () => {
    await upsertUser(db, { id: "r-old", email: "reagen.brase@gmail.com", name: null });
    const month = new Date().toISOString().slice(0, 7);
    const spend = db.sqlite.prepare("INSERT INTO ai_usage (owner, month, model, calls, input_tokens, output_tokens) VALUES (?, ?, ?, 1, ?, ?)");
    spend.run("r-1", month, "claude-haiku-5-5", 1_000_000, 0); // 10 cents
    spend.run("r-old", month, "claude-haiku-5-5", 0, 100_000); // 5 cents
    spend.run("r-1", "2026-01", "claude-haiku-5-5", 9_000_000, 0); // another month
    spend.run("google-sub-josh", month, "claude-sonnet-5-5", 1_000_000, 0); // someone else
    expect((await kitchenGlance({ DB: db } as Env, "reagenbrase@gmail.com", "2026-10-12")).aiCents).toBe(15);
    expect((await kitchenGlance({ DB: db } as Env, "josh.wollberg@gmail.com", "2026-10-12")).aiCents).toBe(200);
  });

  it("still asks the People list first", async () => {
    const env = { ALLOWED_EMAILS: "josh.wollberg@gmail.com" };
    const ask = (email: string) => call(glanceRoute, null, post("/internal/glance", { email, today: "2026-10-12" }), {}, env);
    expect((await (await ask("josh.wollberg@gmail.com")).json()).kitchen).toBe("Josh's kitchen");
    expect(await (await ask("someone@example.com")).json()).toBeNull();
  });

  it("names a kitchen from the first name, else the address", () => {
    expect(kitchenName({ name: "Gwenevere Greenwood", email: "x@y.z" })).toBe("Gwenevere's kitchen");
    expect(kitchenName({ name: null, email: "sam.cook+food@gmail.com" })).toBe("Sam's kitchen");
  });
});

describe("forgetting a person", () => {
  beforeEach(async () => {
    db = openWith();
    seedLibrary(db);
    for (const [id, email] of [
      ["j", "josh.wollberg@gmail.com"],
      ["r", "reagenbrase@gmail.com"],
      ["r-old", "reagen.brase@gmail.com"], // the same inbox, an older spelling
    ]) {
      await upsertUser(db, { id, email });
      await savePlan(db, id, week("2026-10-11", [{ date: "2026-10-12", recipeId: "falafel" }]));
      await mutateShopping(db, id, (l) => applyListEdit(l, { type: "addDish", dish: { recipeId: "potato-soup" } }));
      await setTick(db, id, "ingredient:tomato", true);
      await db.prepare("INSERT INTO pantry (user_id, data, updated_at) VALUES (?, '[]', ?)").bind(id, STAMP).run();
    }
    // A recipe Reagen wrote, and Josh's list last touched by her in the household days.
    db.sqlite.prepare("UPDATE recipes SET updated_by = 'r' WHERE id = 'falafel'").run();
    db.sqlite.prepare("UPDATE shopping SET updated_by = 'r' WHERE user_id = 'j'").run();
  });

  const count = async (table: string, where = "1") =>
    (await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).first<{ n: number }>())?.n;

  it("removes their planning and users rows, and only theirs", async () => {
    const library = await loadLibrary(db);
    expect(await forgetPerson(db, "Reagen.Brase@gmail.com")).toEqual({
      plans: 2,
      shopping: 2,
      shopping_ticks: 2,
      pantry: 2,
      users: 2,
    });
    for (const table of ["plans", "shopping", "shopping_ticks", "pantry"]) {
      expect(await count(table)).toBe(1);
      expect(await count(table, "user_id = 'j'")).toBe(1);
    }
    expect(await count("users")).toBe(1);

    // The library is whole; it just no longer names her.
    expect(await loadLibrary(db)).toEqual(library);
    expect(await count("recipes", "updated_by = 'r'")).toBe(0);
    expect(await count("shopping", "updated_by IS NULL AND user_id = 'j'")).toBe(1);
    expect((await loadShoppingState(db, "j")).extras.dishes).toEqual([{ recipeId: "potato-soup" }]);
  });

  it("answers through Home's route, and refuses a request without an address", async () => {
    const res = await call(forgetRoute, null, post("/internal/forget", { email: "josh.wollberg@gmail.com" }));
    expect(await res.json()).toEqual({
      ok: true,
      removed: { plans: 1, shopping: 1, shopping_ticks: 1, pantry: 1, users: 1 },
    });
    expect(await count("users")).toBe(2);

    for (const body of [{}, { email: "" }, { email: 7 }, { email: "not an address" }]) {
      const bad = await call(forgetRoute, null, post("/internal/forget", body));
      expect(bad.status).toBe(400);
      expect(await bad.json()).toHaveProperty("error");
    }
    const nobody = await call(forgetRoute, null, post("/internal/forget", { email: "nobody@example.com" }));
    expect((await nobody.json()).removed).toEqual({ plans: 0, shopping: 0, shopping_ticks: 0, pantry: 0, users: 0 });
    expect(await count("users")).toBe(2);
  });
});

describe("migration 0002: households to people", () => {
  const plan = (monday: string, recipeId: string) =>
    JSON.stringify(week(monday, [{ date: monday, recipeId }]));

  it("gives each household's rows to whoever made it, intact", async () => {
    db = openWith(["0001_init.sql"]);
    seedLibrary(db, "josh-sub");
    db.sqlite.exec(`
      INSERT INTO users (id, email, name, picture, household_id, created_at, seen_at) VALUES
        ('josh-sub', 'josh.wollberg@gmail.com', 'Josh Wollberg', 'https://photo/j', 'hh-josh', '2026-01-01', '2026-10-10'),
        ('reagen-id', 'reagenbrase@gmail.com', NULL, NULL, 'hh-josh', '2026-09-01', '2026-10-09'),
        ('gwen-id', 'gwenevere.greenwood@gmail.com', NULL, NULL, 'hh-gwen-2', '2026-09-02', '2026-10-08');
      INSERT INTO households (id, name, created_by, created_at) VALUES
        ('hh-josh', 'Josh''s Kitchen', 'josh-sub', '2026-01-01'),
        ('hh-reagen', 'Reagen''s Kitchen', 'reagen-id', '2026-09-01'),
        ('hh-gwen-1', 'Gwenevere''s Kitchen', 'gwen-id', '2026-09-02'),
        ('hh-gwen-2', 'Studio', 'gwen-id', '2026-09-03');
    `);
    const insertPlan = db.sqlite.prepare("INSERT INTO plans VALUES (?, ?, ?, ?, ?)");
    // Josh's household, which Reagen also worked in.
    insertPlan.run("hh-josh", "week-2026-10-05", plan("2026-10-05", "falafel"), "2026-10-04T10:00:00Z", "josh-sub");
    insertPlan.run("hh-josh", "week-2026-10-12", plan("2026-10-12", "potato-soup"), "2026-10-09T10:00:00Z", "reagen-id");
    // Gwen made two; both planned the week of the 12th, the second one later.
    insertPlan.run("hh-gwen-1", "week-2026-10-12", plan("2026-10-12", "deviled-eggs"), "2026-10-05T10:00:00Z", "gwen-id");
    insertPlan.run("hh-gwen-1", "week-2026-10-19", plan("2026-10-19", "apple-crisp"), "2026-10-05T10:00:00Z", "gwen-id");
    insertPlan.run("hh-gwen-2", "week-2026-10-12", plan("2026-10-12", "falafel"), "2026-10-07T10:00:00Z", "gwen-id");
    const joshList = JSON.stringify({ dishes: [{ recipeId: "potato-soup", servings: 6 }], items: [{ id: "i1", name: "paper towels" }], planId: null });
    db.sqlite.exec(`
      INSERT INTO shopping VALUES
        ('hh-josh', '${joshList}', '2026-10-09T11:00:00Z', 'reagen-id'),
        ('hh-gwen-1', '{"dishes":[{"recipeId":"falafel"}],"items":[]}', '2026-10-08T09:00:00Z', 'gwen-id'),
        ('hh-gwen-2', '{"dishes":[{"recipeId":"apple-crisp"}],"items":[]}', '2026-10-06T09:00:00Z', 'gwen-id');
      INSERT INTO shopping_ticks VALUES
        ('hh-josh', 'ingredient:tomato', '2026-10-09T12:00:00Z'),
        ('hh-josh', 'item:i1', '2026-10-09T12:01:00Z'),
        ('hh-gwen-1', 'ingredient:chickpeas', '2026-10-08T10:00:00Z'),
        ('hh-gwen-2', 'ingredient:apple', '2026-10-09T10:00:00Z');
      INSERT INTO pantry VALUES
        ('hh-josh', '[{"ingredientId":"salt","quantity":1,"unit":"each"}]', '2026-10-01T00:00:00Z'),
        ('hh-gwen-1', '[{"ingredientId":"olive-oil","quantity":500,"unit":"ml"}]', '2026-10-01T00:00:00Z'),
        ('hh-gwen-2', '[{"ingredientId":"flour","quantity":1000,"unit":"g"}]', '2026-10-02T00:00:00Z');
    `);
    db.sqlite.close();

    db = openWith(readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")));
    const rows = (sql: string) => db.sqlite.prepare(sql).all();

    expect(rows("SELECT name FROM sqlite_master WHERE name = 'households'")).toEqual([]);
    expect(rows("SELECT name FROM pragma_table_info('users') WHERE name = 'household_id'")).toEqual([]);
    expect(rows("PRAGMA foreign_key_check")).toEqual([]);
    expect(rows("SELECT id, email, name, picture, created_at, seen_at FROM users ORDER BY id")).toEqual([
      { id: "gwen-id", email: "gwenevere.greenwood@gmail.com", name: null, picture: null, created_at: "2026-09-02", seen_at: "2026-10-08" },
      { id: "josh-sub", email: "josh.wollberg@gmail.com", name: "Josh Wollberg", picture: "https://photo/j", created_at: "2026-01-01", seen_at: "2026-10-10" },
      { id: "reagen-id", email: "reagenbrase@gmail.com", name: null, picture: null, created_at: "2026-09-01", seen_at: "2026-10-09" },
    ]);

    // Josh's household is Josh's, byte for byte: his plans, list, ticks and pantry.
    expect(rows("SELECT id, data, updated_at, updated_by FROM plans WHERE user_id = 'josh-sub' ORDER BY id")).toEqual([
      { id: "week-2026-10-05", data: plan("2026-10-05", "falafel"), updated_at: "2026-10-04T10:00:00Z", updated_by: "josh-sub" },
      { id: "week-2026-10-12", data: plan("2026-10-12", "potato-soup"), updated_at: "2026-10-09T10:00:00Z", updated_by: "reagen-id" },
    ]);
    expect(rows("SELECT data, updated_at, updated_by FROM shopping WHERE user_id = 'josh-sub'")).toEqual([
      { data: joshList, updated_at: "2026-10-09T11:00:00Z", updated_by: "reagen-id" },
    ]);
    expect(rows("SELECT line_key, ticked_at FROM shopping_ticks WHERE user_id = 'josh-sub' ORDER BY line_key")).toEqual([
      { line_key: "ingredient:tomato", ticked_at: "2026-10-09T12:00:00Z" },
      { line_key: "item:i1", ticked_at: "2026-10-09T12:01:00Z" },
    ]);
    expect(rows("SELECT data FROM pantry WHERE user_id = 'josh-sub'")).toEqual([{ data: '[{"ingredientId":"salt","quantity":1,"unit":"each"}]' }]);

    // Reagen worked in Josh's household, but her own was empty: so is her kitchen.
    for (const table of ["plans", "shopping", "shopping_ticks", "pantry"]) {
      expect(rows(`SELECT * FROM ${table} WHERE user_id = 'reagen-id'`)).toEqual([]);
    }

    // Gwen's two: each week from whichever copy changed last, the list (and its ticks)
    // from the household whose list saw anything last, the pantry updated last.
    expect(rows("SELECT id, data FROM plans WHERE user_id = 'gwen-id' ORDER BY id")).toEqual([
      { id: "week-2026-10-12", data: plan("2026-10-12", "falafel") },
      { id: "week-2026-10-19", data: plan("2026-10-19", "apple-crisp") },
    ]);
    expect(rows("SELECT data FROM shopping WHERE user_id = 'gwen-id'")).toEqual([
      { data: '{"dishes":[{"recipeId":"apple-crisp"}],"items":[]}' },
    ]);
    expect(rows("SELECT line_key FROM shopping_ticks WHERE user_id = 'gwen-id'")).toEqual([{ line_key: "ingredient:apple" }]);
    expect(rows("SELECT data FROM pantry WHERE user_id = 'gwen-id'")).toEqual([{ data: '[{"ingredientId":"flour","quantity":1000,"unit":"g"}]' }]);

    // The library did not move, and the app reads the result.
    expect(rows("SELECT COUNT(*) AS n FROM recipes WHERE updated_by = 'josh-sub'")).toEqual([
      { n: readdirSync(join(SEED, "recipes")).length },
    ]);
    const josh = await userForEmail(db, "josh.wollberg@gmail.com");
    expect(josh.id).toBe("josh-sub");
    const planning = await loadPlanning(db, josh.id);
    // Its Monday weeks come back as the Sunday weeks holding those Mondays.
    expect(planning.plans.map((p) => p.id)).toEqual(["week-2026-10-11", "week-2026-10-04"]);
    expect(planning.shopping.dishes).toEqual([{ recipeId: "potato-soup", servings: 6 }]);
    expect(planning.ticked.sort()).toEqual(["ingredient:tomato", "item:i1"]);
    expect(planning.pantry).toEqual([{ ingredientId: "salt", quantity: 1, unit: "each" }]);
  });

  it("leaves a database with no households empty-handed but whole", async () => {
    db = openWith(["0001_init.sql"]);
    seedLibrary(db);
    db.sqlite.close();
    db = openWith();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM plans").get()).toEqual({ n: 0 });
    expect((await loadLibrary(db)).meals.length).toBe(readdirSync(join(SEED, "meals")).length);
  });
});

describe("saving an item from the list", () => {
  it("adds it to everyone's library, and refuses a second one with the same id", async () => {
    db = openWith();
    seedLibrary(db);
    const josh = await upsertUser(db, { id: "google-sub-josh", email: "josh.wollberg@gmail.com", name: "Josh Wollberg" });
    const towels = { id: "paper-towels", name: "Paper towels", aisle: "household", aliases: [], isStaple: false, defaultUnit: "package" };

    const res = await call(createItem, josh, post("/api/ingredients", { ingredient: towels }));
    expect(res.status).toBe(201);
    expect((await loadLibrary(db)).ingredients.find((i) => i.id === "paper-towels")?.aisle).toBe("household");

    const again = await call(createItem, josh, post("/api/ingredients", { ingredient: { ...towels, name: "Towels" } }));
    expect(again.status).toBe(409);
    expect((await loadLibrary(db)).ingredients.find((i) => i.id === "paper-towels")?.name).toBe("Paper towels");
  });
});
