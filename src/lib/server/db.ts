/**
 * D1 access. SERVER ONLY — imported from Astro pages, API routes and the
 * middleware, never from a React island.
 *
 * The library (ingredients, recipes, meals) is everyone's. Planning (week
 * plans, the shopping list, its ticks, the pantry) is each person's own:
 * every function that touches it takes that person's users.id and reads or
 * writes only their rows, so someone else's simply isn't there — a page or
 * route never filters it itself.
 *
 * Documents are validated with the zod schemas on the way in and on the way
 * out. A record that fails on read is skipped and logged rather than taking
 * the whole page down with it.
 */

import type { D1Database } from "./d1";
import {
  IngredientSchema,
  MealPlanSchema,
  MealSchema,
  PantryFileSchema,
  RecipeSchema,
  ShoppingExtrasSchema,
  type Ingredient,
  type Meal,
  type MealPlan,
  type PantryItem,
  type Price,
  type Recipe,
  type ShoppingExtras,
} from "../schema";
import { emptyExtras } from "../list";
import { toSundayWeeks } from "../plans";
import { ownerKey } from "./people";

const now = () => new Date().toISOString();

interface Parser<T> {
  parse(value: unknown): T;
}

function parseDocs<T>(rows: { data: string }[] | undefined, schema: Parser<T>, label: string): T[] {
  const out: T[] = [];
  for (const row of rows ?? []) {
    try {
      out.push(schema.parse(JSON.parse(row.data)));
    } catch (error) {
      console.error(`Skipping an invalid ${label}:`, error instanceof Error ? error.message : error);
    }
  }
  return out;
}

export class ConflictError extends Error {}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export interface Viewer {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

const toViewer = (row: UserRow): Viewer => ({
  id: row.id,
  email: row.email,
  name: row.name,
  picture: row.picture,
});

export async function loadViewer(db: D1Database, id: string): Promise<Viewer | null> {
  const row = await db
    .prepare("SELECT id, email, name, picture FROM users WHERE id = ?")
    .bind(id)
    .first<UserRow>();
  return row ? toViewer(row) : null;
}

export async function upsertUser(
  db: D1Database,
  user: { id: string; email: string; name?: string | null; picture?: string | null },
): Promise<Viewer> {
  const stamp = now();
  const row = await db
    .prepare(
      `INSERT INTO users (id, email, name, picture, created_at, seen_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email, name = excluded.name,
         picture = excluded.picture, seen_at = excluded.seen_at
       RETURNING id, email, name, picture`,
    )
    .bind(user.id, user.email, user.name ?? null, user.picture ?? null, stamp)
    .first<UserRow>();
  if (!row) throw new Error("Could not save the user.");
  return toViewer(row);
}

/**
 * Every users row that is this person: the address compared by `ownerKey`
 * (case, dots and +tags don't matter), the row spelled exactly as given
 * first, then the oldest. There are only a handful of users, so comparing
 * them all is cheaper than being clever. Never creates one.
 */
export async function usersForEmail(db: D1Database, email: string): Promise<Viewer[]> {
  const wanted = ownerKey(email);
  const exact = email.trim().toLowerCase();
  const { results } = await db
    .prepare("SELECT id, email, name, picture FROM users ORDER BY created_at, id")
    .all<UserRow>();
  return results
    .filter((row) => ownerKey(row.email) === wanted)
    .sort((a, b) => Number(b.email.toLowerCase() === exact) - Number(a.email.toLowerCase() === exact))
    .map(toViewer);
}

/**
 * The person signed in through Cloudflare Access, by email. Everyone who
 * signed in before the switch to Access is keyed by their Google id, so the
 * match is on the address, never on an id. Someone new gets a row of their
 * own; a later visit finds it the same way.
 */
export async function userForEmail(db: D1Database, email: string): Promise<Viewer> {
  const [found] = await usersForEmail(db, email);
  return found ?? upsertUser(db, { id: crypto.randomUUID(), email: email.trim() });
}

/**
 * Keep a person's photo and name in step with their Google account, as the
 * login passes them along. Writes only when something changed, which is
 * almost never.
 */
export async function refreshProfile(
  db: D1Database,
  viewer: Viewer,
  from: { name?: string; picture?: string },
): Promise<Viewer> {
  const name = from.name ?? viewer.name;
  const picture = from.picture ?? viewer.picture;
  if (name === viewer.name && picture === viewer.picture) return viewer;
  await db.prepare("UPDATE users SET name = ?, picture = ? WHERE id = ?").bind(name, picture, viewer.id).run();
  return { ...viewer, name, picture };
}

/**
 * "Josh's kitchen": the first name Google gave us or, for someone who
 * arrived through Access (which sends only the address), the address's
 * first word.
 */
export function kitchenName(person: Pick<Viewer, "name" | "email">): string {
  const first = person.name?.trim().split(/\s+/)[0] || person.email.split("@")[0].split(/[._+-]/)[0] || "Your";
  const pretty = first.charAt(0).toUpperCase() + first.slice(1);
  return `${pretty}'s kitchen`;
}

/**
 * Forget a person (Home's People page, when someone is removed): their week
 * plans, shopping list, ticks and pantry, and their users row, for every row
 * that is them by `ownerKey`. The library stays whole: the recipes, meals and
 * ingredients they wrote are everyone's, so they are kept, and only the
 * `updated_by` that names them is cleared (it is a plain note, not a foreign
 * key, so nothing else changes). Counts what went, by table.
 */
export async function forgetPerson(db: D1Database, email: string): Promise<Record<string, number>> {
  const ids = (await usersForEmail(db, email)).map((u) => u.id);
  const removed: Record<string, number> = { plans: 0, shopping: 0, shopping_ticks: 0, pantry: 0, users: 0 };
  if (ids.length === 0) return removed;
  const marks = ids.map(() => "?").join(",");
  const tables = Object.keys(removed);
  const results = await db.batch([
    // Their own rows first, so the counts are theirs (the users row would
    // cascade to them anyway).
    ...tables.map((table) =>
      db.prepare(`DELETE FROM ${table} WHERE ${table === "users" ? "id" : "user_id"} IN (${marks})`).bind(...ids),
    ),
    // Whatever else still names them (the library, and lists from the
    // household days that are someone else's now).
    ...["ingredients", "recipes", "meals", "plans", "shopping"].map((table) =>
      db.prepare(`UPDATE ${table} SET updated_by = NULL WHERE updated_by IN (${marks})`).bind(...ids),
    ),
  ]);
  tables.forEach((table, i) => (removed[table] = results[i].meta.changes));
  return removed;
}

// ---------------------------------------------------------------------------
// Shared library
// ---------------------------------------------------------------------------

export interface Library {
  ingredients: Ingredient[];
  recipes: Recipe[];
  meals: Meal[];
}

export async function loadLibrary(db: D1Database): Promise<Library> {
  const [ingredients, recipes, meals] = await db.batch<{ data: string }>([
    db.prepare("SELECT data FROM ingredients"),
    db.prepare("SELECT data FROM recipes"),
    db.prepare("SELECT data FROM meals"),
  ]);
  return {
    ingredients: parseDocs(ingredients.results, IngredientSchema, "ingredient").sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    recipes: parseDocs(recipes.results, RecipeSchema, "recipe").sort((a, b) =>
      a.title.localeCompare(b.title),
    ),
    meals: parseDocs(meals.results, MealSchema, "meal").sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Save a new library item on its own, outside any recipe: an ingredient, or a
 * household thing like paper towels that a list keeps coming back to.
 * Refuses an id that's taken rather than overwriting someone's item.
 */
export async function createIngredient(db: D1Database, ingredient: Ingredient, userId: string): Promise<Ingredient> {
  const doc = IngredientSchema.parse(ingredient);
  const taken = await db.prepare("SELECT 1 AS one FROM ingredients WHERE id = ?").bind(doc.id).first();
  if (taken) throw new ConflictError(`“${doc.name}” is already saved.`);
  await db
    .prepare("INSERT INTO ingredients (id, data, updated_at, updated_by) VALUES (?, ?, ?, ?)")
    .bind(doc.id, JSON.stringify(doc), now(), userId)
    .run();
  return doc;
}

/**
 * Set or clear one ingredient's price, leaving the rest of it as it is. Null
 * when there's no such ingredient. Ingredients are shared, like recipes, so
 * the price changes for everyone.
 */
export async function saveIngredientPrice(
  db: D1Database,
  id: string,
  price: Price | null,
  userId: string,
): Promise<Ingredient | null> {
  const row = await db.prepare("SELECT data FROM ingredients WHERE id = ?").bind(id).first<{ data: string }>();
  const current = row ? parseDocs([row], IngredientSchema, "ingredient")[0] : undefined;
  if (!current) return null;
  const doc = IngredientSchema.parse({ ...current, price: price ?? undefined });
  await db
    .prepare("UPDATE ingredients SET data = ?, updated_at = ?, updated_by = ? WHERE id = ?")
    .bind(JSON.stringify(doc), now(), userId, id)
    .run();
  return doc;
}

export async function loadRecipe(db: D1Database, id: string): Promise<Recipe | null> {
  const row = await db.prepare("SELECT data FROM recipes WHERE id = ?").bind(id).first<{ data: string }>();
  return row ? (parseDocs([row], RecipeSchema, "recipe")[0] ?? null) : null;
}

/**
 * Save a recipe plus any ingredients it introduced, in ONE transaction.
 *
 * A D1 batch either fully applies or not at all, so a recipe can never land
 * referencing an ingredient that failed to write — the same guarantee the
 * old single-commit write path existed to give.
 */
export async function saveRecipe(
  db: D1Database,
  recipe: Recipe,
  newIngredients: Ingredient[],
  userId: string,
): Promise<Recipe> {
  const stamp = now();
  const doc = RecipeSchema.parse({ ...recipe, updatedAt: stamp });
  const added = newIngredients.map((i) => IngredientSchema.parse(i));

  const { results } = await db.prepare("SELECT id FROM ingredients").all<{ id: string }>();
  const known = new Set([...results.map((r: { id: string }) => r.id), ...added.map((i) => i.id)]);
  const dangling = doc.ingredients.filter((line) => !known.has(line.ingredientId));
  if (dangling.length > 0) {
    throw new ConflictError(`Unknown ingredient: ${dangling.map((l) => l.ingredientId).join(", ")}.`);
  }

  await db.batch([
    ...added.map((ingredient) =>
      // OR IGNORE: if someone else created the same id first, theirs stands —
      // ids come from names, so it is the same ingredient either way.
      db
        .prepare("INSERT OR IGNORE INTO ingredients (id, data, updated_at, updated_by) VALUES (?, ?, ?, ?)")
        .bind(ingredient.id, JSON.stringify(ingredient), stamp, userId),
    ),
    db
      .prepare(
        `INSERT INTO recipes (id, data, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .bind(doc.id, JSON.stringify(doc), stamp, userId),
  ]);
  return doc;
}

/** Refuses while a meal still uses the recipe, rather than leaving the meal pointing at nothing. */
export async function deleteRecipe(db: D1Database, id: string): Promise<void> {
  const { meals } = await loadLibrary(db);
  const users = meals.filter((m) => m.components.some((c) => c.recipeId === id));
  if (users.length > 0) {
    throw new ConflictError(`Used by ${users.map((m) => m.name).join(", ")} — remove it there first.`);
  }
  await db.prepare("DELETE FROM recipes WHERE id = ?").bind(id).run();
}

// ---------------------------------------------------------------------------
// Each person's planning — every read and write names whose it is
// ---------------------------------------------------------------------------

export interface Planning {
  plans: MealPlan[];
  shopping: ShoppingExtras;
  ticked: string[];
  pantry: PantryItem[];
}

export async function loadPlanning(db: D1Database, userId: string): Promise<Planning> {
  const [plans, shopping, ticks, pantry] = await db.batch<Record<string, string>>([
    db.prepare("SELECT data, updated_at FROM plans WHERE user_id = ?").bind(userId),
    db.prepare("SELECT data FROM shopping WHERE user_id = ?").bind(userId),
    db.prepare("SELECT line_key FROM shopping_ticks WHERE user_id = ?").bind(userId),
    db.prepare("SELECT data FROM pantry WHERE user_id = ?").bind(userId),
  ]);
  const pantryRow = pantry.results[0] as { data: string } | undefined;
  return {
    plans: (await sundayWeeks(db, userId, plans.results as PlanRow[])).sort((a, b) =>
      (b.days[0]?.date ?? "").localeCompare(a.days[0]?.date ?? ""),
    ),
    shopping:
      parseDocs(shopping.results as { data: string }[], ShoppingExtrasSchema, "shopping list")[0] ??
      emptyExtras(),
    ticked: (ticks.results as { line_key: string }[]).map((r) => r.line_key),
    pantry: pantryRow ? (parseDocs([pantryRow], PantryFileSchema, "pantry")[0] ?? []) : [],
  };
}

type PlanRow = { data: string; updated_at: string };

/**
 * A person's plans as Sunday-to-Saturday weeks. Plans still stored as Monday
 * weeks (before 2026-10, or saved by a tab open from then) are regrouped and
 * written back as Sunday weeks, the first time they are read. An old row is
 * deleted only if nobody saved over it since this read; one that changed is
 * regrouped on the next read instead.
 */
async function sundayWeeks(db: D1Database, userId: string, rows: PlanRow[]): Promise<MealPlan[]> {
  const read = parseDocs(rows, MealPlanSchema, "plan");
  const { plans, changed } = toSundayWeeks(read);
  if (!changed) return plans;
  const keep = new Set(plans.map((p) => p.id));
  const stamps = new Map(rows.map((r) => [(JSON.parse(r.data) as { id?: string }).id, r.updated_at]));
  const stamp = now();
  await db.batch([
    ...read
      .filter((p) => !keep.has(p.id))
      .map((p) =>
        db
          .prepare("DELETE FROM plans WHERE user_id = ? AND id = ? AND updated_at = ?")
          .bind(userId, p.id, stamps.get(p.id) ?? ""),
      ),
    ...plans.map((p) =>
      db
        .prepare(
          `INSERT INTO plans (user_id, id, data, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, id) DO UPDATE SET
             data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        )
        .bind(userId, p.id, JSON.stringify(p), stamp, userId),
    ),
  ]);
  return plans;
}

export async function savePlan(db: D1Database, userId: string, plan: MealPlan): Promise<MealPlan> {
  const stamp = now();
  const doc = MealPlanSchema.parse({ ...plan, updatedAt: stamp });
  await db
    .prepare(
      `INSERT INTO plans (user_id, id, data, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, id) DO UPDATE SET
         data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(userId, doc.id, JSON.stringify(doc), stamp, userId)
    .run();
  return doc;
}

/** One of this person's week plans, or null: someone else's is not theirs to see. */
export async function loadPlan(db: D1Database, userId: string, id: string): Promise<MealPlan | null> {
  const rows = await db.prepare("SELECT data, updated_at FROM plans WHERE user_id = ?").bind(userId).all<PlanRow>();
  return (await sundayWeeks(db, userId, rows.results)).find((p) => p.id === id) ?? null;
}

/**
 * Apply an edit to a person's shopping list.
 *
 * Two tabs or phones can add to the same list at once, so this is optimistic
 * concurrency: read, apply the pure edit, and write back only if nobody else
 * wrote in between — otherwise re-read and apply again. Re-applying is safe
 * because every edit is a function of the current list, not a replacement.
 */
export async function mutateShopping(
  db: D1Database,
  userId: string,
  edit: (current: ShoppingExtras) => ShoppingExtras,
): Promise<ShoppingExtras> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await db
      .prepare("SELECT data, updated_at FROM shopping WHERE user_id = ?")
      .bind(userId)
      .first<{ data: string; updated_at: string }>();
    const current = row
      ? (parseDocs([row], ShoppingExtrasSchema, "shopping list")[0] ?? emptyExtras())
      : emptyExtras();

    const stamp = now();
    const next = ShoppingExtrasSchema.parse({ ...edit(current), updatedAt: stamp });
    const data = JSON.stringify(next);

    const result = row
      ? await db
          .prepare(
            "UPDATE shopping SET data = ?, updated_at = ?, updated_by = ? WHERE user_id = ? AND updated_at = ?",
          )
          .bind(data, stamp, userId, userId, row.updated_at)
          .run()
      : await db
          .prepare(
            `INSERT INTO shopping (user_id, data, updated_at, updated_by) VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id) DO NOTHING`,
          )
          .bind(userId, data, stamp, userId)
          .run();

    if (result.meta.changes === 1) return next;
  }
  throw new ConflictError("The list is changing too quickly — try again.");
}

export async function setTick(db: D1Database, userId: string, key: string, on: boolean): Promise<void> {
  if (on) {
    await db
      .prepare("INSERT OR IGNORE INTO shopping_ticks (user_id, line_key, ticked_at) VALUES (?, ?, ?)")
      .bind(userId, key, now())
      .run();
  } else {
    await db
      .prepare("DELETE FROM shopping_ticks WHERE user_id = ? AND line_key = ?")
      .bind(userId, key)
      .run();
  }
}

export async function clearTicks(db: D1Database, userId: string): Promise<void> {
  await db.prepare("DELETE FROM shopping_ticks WHERE user_id = ?").bind(userId).run();
}

export async function loadTicks(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT line_key FROM shopping_ticks WHERE user_id = ?")
    .bind(userId)
    .all<{ line_key: string }>();
  return results.map((r: { line_key: string }) => r.line_key);
}

export interface ShoppingState {
  extras: ShoppingExtras;
  ticked: string[];
}

export async function loadShoppingState(db: D1Database, userId: string): Promise<ShoppingState> {
  const [shopping, ticks] = await db.batch<Record<string, string>>([
    db.prepare("SELECT data FROM shopping WHERE user_id = ?").bind(userId),
    db.prepare("SELECT line_key FROM shopping_ticks WHERE user_id = ?").bind(userId),
  ]);
  return {
    extras:
      parseDocs(shopping.results as { data: string }[], ShoppingExtrasSchema, "shopping list")[0] ??
      emptyExtras(),
    ticked: (ticks.results as { line_key: string }[]).map((r) => r.line_key),
  };
}

/** How many things are on the list beyond the plan — the nav badge. */
export async function countList(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare("SELECT data FROM shopping WHERE user_id = ?")
    .bind(userId)
    .first<{ data: string }>();
  const extras = row ? parseDocs([row], ShoppingExtrasSchema, "shopping list")[0] : undefined;
  return extras ? extras.dishes.length + extras.items.length : 0;
}
