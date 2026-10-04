/**
 * D1 access. SERVER ONLY — imported from Astro pages, API routes and the
 * middleware, never from a React island.
 *
 * Documents are validated with the zod schemas on the way in and on the way
 * out. A record that fails on read is skipped and logged rather than taking
 * the whole page down with it.
 */

import type { D1Database } from "@cloudflare/workers-types";
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
  type Recipe,
  type ShoppingExtras,
} from "../schema";
import { emptyExtras } from "../list";
import { canonicalEmail } from "./auth";

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
// Users and households
// ---------------------------------------------------------------------------

export interface Viewer {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  householdId: string | null;
}

export interface Household {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  /** Display name of whoever it was made for. */
  creatorName?: string | null;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  household_id: string | null;
}

interface HouseholdRow {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  creator_name?: string | null;
}

const toViewer = (row: UserRow): Viewer => ({
  id: row.id,
  email: row.email,
  name: row.name,
  picture: row.picture,
  householdId: row.household_id,
});

const toHousehold = (row: HouseholdRow): Household => ({
  id: row.id,
  name: row.name,
  createdBy: row.created_by,
  createdAt: row.created_at,
  creatorName: row.creator_name ?? null,
});

export async function loadViewer(db: D1Database, id: string): Promise<Viewer | null> {
  const row = await db
    .prepare("SELECT id, email, name, picture, household_id FROM users WHERE id = ?")
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
       RETURNING id, email, name, picture, household_id`,
    )
    .bind(user.id, user.email, user.name ?? null, user.picture ?? null, stamp)
    .first<UserRow>();
  if (!row) throw new Error("Could not save the user.");
  return toViewer(row);
}

/**
 * The person signed in through Cloudflare Access, by email. Everyone who
 * signed in before the switch to Access is keyed by their Google id, so the
 * match is on the address (compared the Gmail way), never on an id. Someone
 * new gets a row of their own; a later visit finds it the same way.
 */
export async function userForEmail(db: D1Database, email: string): Promise<Viewer> {
  const exact = await db
    .prepare("SELECT id, email, name, picture, household_id FROM users WHERE lower(email) = ?")
    .bind(email.trim().toLowerCase())
    .first<UserRow>();
  if (exact) return toViewer(exact);

  // The same Gmail inbox spelled differently (dots, +tags). There are only a
  // handful of users, so comparing them all is cheaper than being clever.
  const wanted = canonicalEmail(email);
  const { results } = await db
    .prepare("SELECT id, email, name, picture, household_id FROM users")
    .all<UserRow>();
  const match = results.find((row) => canonicalEmail(row.email) === wanted);
  if (match) return toViewer(match);

  return upsertUser(db, { id: crypto.randomUUID(), email: email.trim() });
}

/**
 * "Josh's Kitchen", from the name Google gave us or, for someone who arrived
 * through Access (which sends only the address), the address's first word.
 */
export function defaultHouseholdName(viewer: Pick<Viewer, "name" | "email">): string {
  const first = viewer.name?.trim().split(/\s+/)[0] || viewer.email.split("@")[0].split(/[._+-]/)[0];
  const pretty = first.charAt(0).toUpperCase() + first.slice(1);
  return `${pretty}'s Kitchen`;
}

export function cleanHouseholdName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 60);
}

export async function listHouseholds(db: D1Database): Promise<Household[]> {
  const { results } = await db
    .prepare(
      `SELECT h.id, h.name, h.created_by, h.created_at, u.name AS creator_name
       FROM households h LEFT JOIN users u ON u.id = h.created_by
       ORDER BY h.name COLLATE NOCASE`,
    )
    .all<HouseholdRow>();
  return results.map(toHousehold);
}

export async function getHousehold(db: D1Database, id: string): Promise<Household | null> {
  const row = await db
    .prepare("SELECT id, name, created_by, created_at FROM households WHERE id = ?")
    .bind(id)
    .first<HouseholdRow>();
  return row ? toHousehold(row) : null;
}

export async function createHousehold(db: D1Database, createdBy: string, name: string): Promise<Household> {
  const household: Household = {
    id: crypto.randomUUID(),
    name: cleanHouseholdName(name) || "New household",
    createdBy,
    createdAt: now(),
  };
  await db
    .prepare("INSERT INTO households (id, name, created_by, created_at) VALUES (?, ?, ?, ?)")
    .bind(household.id, household.name, household.createdBy, household.createdAt)
    .run();
  return household;
}

export async function renameHousehold(db: D1Database, id: string, name: string): Promise<void> {
  const clean = cleanHouseholdName(name);
  if (!clean) throw new ConflictError("A household needs a name.");
  await db.prepare("UPDATE households SET name = ? WHERE id = ?").bind(clean, id).run();
}

export async function setActiveHousehold(db: D1Database, userId: string, householdId: string): Promise<void> {
  await db.prepare("UPDATE users SET household_id = ? WHERE id = ?").bind(householdId, userId).run();
}

/**
 * The household this person is working in, creating their own on first
 * visit. Any approved user may work in any household, so there is no
 * membership to check — only that the household still exists.
 */
export async function ensureHousehold(db: D1Database, viewer: Viewer): Promise<Household> {
  if (viewer.householdId) {
    const current = await getHousehold(db, viewer.householdId);
    if (current) return current;
  }
  const own = await db
    .prepare(
      "SELECT id, name, created_by, created_at FROM households WHERE created_by = ? ORDER BY created_at LIMIT 1",
    )
    .bind(viewer.id)
    .first<HouseholdRow>();
  const household = own ? toHousehold(own) : await createHousehold(db, viewer.id, defaultHouseholdName(viewer));
  await setActiveHousehold(db, viewer.id, household.id);
  viewer.householdId = household.id;
  return household;
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
// Household planning
// ---------------------------------------------------------------------------

export interface Planning {
  plans: MealPlan[];
  shopping: ShoppingExtras;
  ticked: string[];
  pantry: PantryItem[];
}

export async function loadPlanning(db: D1Database, householdId: string): Promise<Planning> {
  const [plans, shopping, ticks, pantry] = await db.batch<Record<string, string>>([
    db.prepare("SELECT data FROM plans WHERE household_id = ?").bind(householdId),
    db.prepare("SELECT data FROM shopping WHERE household_id = ?").bind(householdId),
    db.prepare("SELECT line_key FROM shopping_ticks WHERE household_id = ?").bind(householdId),
    db.prepare("SELECT data FROM pantry WHERE household_id = ?").bind(householdId),
  ]);
  const pantryRow = pantry.results[0] as { data: string } | undefined;
  return {
    plans: parseDocs(plans.results as { data: string }[], MealPlanSchema, "plan").sort((a, b) =>
      (b.days[0]?.date ?? "").localeCompare(a.days[0]?.date ?? ""),
    ),
    shopping:
      parseDocs(shopping.results as { data: string }[], ShoppingExtrasSchema, "shopping list")[0] ??
      emptyExtras(),
    ticked: (ticks.results as { line_key: string }[]).map((r) => r.line_key),
    pantry: pantryRow ? (parseDocs([pantryRow], PantryFileSchema, "pantry")[0] ?? []) : [],
  };
}

export async function savePlan(
  db: D1Database,
  householdId: string,
  plan: MealPlan,
  userId: string,
): Promise<MealPlan> {
  const stamp = now();
  const doc = MealPlanSchema.parse({ ...plan, updatedAt: stamp });
  await db
    .prepare(
      `INSERT INTO plans (household_id, id, data, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(household_id, id) DO UPDATE SET
         data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(householdId, doc.id, JSON.stringify(doc), stamp, userId)
    .run();
  return doc;
}

/**
 * Apply an edit to the household's shopping list.
 *
 * Two people can add to the same list at once, so this is optimistic
 * concurrency: read, apply the pure edit, and write back only if nobody else
 * wrote in between — otherwise re-read and apply again. Re-applying is safe
 * because every edit is a function of the current list, not a replacement.
 */
export async function mutateShopping(
  db: D1Database,
  householdId: string,
  userId: string,
  edit: (current: ShoppingExtras) => ShoppingExtras,
): Promise<ShoppingExtras> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await db
      .prepare("SELECT data, updated_at FROM shopping WHERE household_id = ?")
      .bind(householdId)
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
            "UPDATE shopping SET data = ?, updated_at = ?, updated_by = ? WHERE household_id = ? AND updated_at = ?",
          )
          .bind(data, stamp, userId, householdId, row.updated_at)
          .run()
      : await db
          .prepare(
            `INSERT INTO shopping (household_id, data, updated_at, updated_by) VALUES (?, ?, ?, ?)
             ON CONFLICT(household_id) DO NOTHING`,
          )
          .bind(householdId, data, stamp, userId)
          .run();

    if (result.meta.changes === 1) return next;
  }
  throw new ConflictError("The list is changing too quickly — try again.");
}

export async function setTick(db: D1Database, householdId: string, key: string, on: boolean): Promise<void> {
  if (on) {
    await db
      .prepare("INSERT OR IGNORE INTO shopping_ticks (household_id, line_key, ticked_at) VALUES (?, ?, ?)")
      .bind(householdId, key, now())
      .run();
  } else {
    await db
      .prepare("DELETE FROM shopping_ticks WHERE household_id = ? AND line_key = ?")
      .bind(householdId, key)
      .run();
  }
}

export async function clearTicks(db: D1Database, householdId: string): Promise<void> {
  await db.prepare("DELETE FROM shopping_ticks WHERE household_id = ?").bind(householdId).run();
}

export async function loadTicks(db: D1Database, householdId: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT line_key FROM shopping_ticks WHERE household_id = ?")
    .bind(householdId)
    .all<{ line_key: string }>();
  return results.map((r: { line_key: string }) => r.line_key);
}

export interface ShoppingState {
  extras: ShoppingExtras;
  ticked: string[];
}

export async function loadShoppingState(db: D1Database, householdId: string): Promise<ShoppingState> {
  const [shopping, ticks] = await db.batch<Record<string, string>>([
    db.prepare("SELECT data FROM shopping WHERE household_id = ?").bind(householdId),
    db.prepare("SELECT line_key FROM shopping_ticks WHERE household_id = ?").bind(householdId),
  ]);
  return {
    extras:
      parseDocs(shopping.results as { data: string }[], ShoppingExtrasSchema, "shopping list")[0] ??
      emptyExtras(),
    ticked: (ticks.results as { line_key: string }[]).map((r) => r.line_key),
  };
}

/** How many things are on the list beyond the plan — the nav badge. */
export async function countList(db: D1Database, householdId: string): Promise<number> {
  const row = await db
    .prepare("SELECT data FROM shopping WHERE household_id = ?")
    .bind(householdId)
    .first<{ data: string }>();
  const extras = row ? parseDocs([row], ShoppingExtrasSchema, "shopping list")[0] : undefined;
  return extras ? extras.dishes.length + extras.items.length : 0;
}
