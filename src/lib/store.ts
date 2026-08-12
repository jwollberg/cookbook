/**
 * Client-side data access and the local-first write path.
 *
 * BROWSER ONLY — pages load data at build time via data.server.ts instead.
 *
 * A commit triggers a Pages rebuild taking ~40-60s, which is far too slow to
 * sit behind a save button. So a save writes to a local stash immediately and
 * pushes to GitHub in the background. On load the published bundle is fetched
 * and the stash is laid over the top, so your own edit is visible instantly
 * while everyone else sees the last published build. Once the rebuild lands,
 * the stashed copy is dropped and the two converge.
 */

import {
  IngredientSchema,
  MealSchema,
  PantryItemSchema,
  RecipeSchema,
  type Ingredient,
  type Meal,
  type PantryItem,
  type Recipe,
} from "./schema";
import { commitFiles, paths, serialise, type RepoConfig } from "./github";

export const REPO = { owner: "jwollberg", repo: "cookbook", branch: "main" } as const;

const TOKEN_KEY = "cookbook:token";
const STASH_KEY = "cookbook:stash";

export interface Cookbook {
  ingredients: Ingredient[];
  recipes: Recipe[];
  meals: Meal[];
  pantry: PantryItem[];
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

export function getToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof localStorage === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getRepoConfig(): RepoConfig | null {
  const token = getToken();
  return token ? { ...REPO, token } : null;
}

// ---------------------------------------------------------------------------
// Local stash
// ---------------------------------------------------------------------------

export interface Stash {
  recipes: Record<string, Recipe>;
  meals: Record<string, Meal>;
  /** Whole file, because ingredients live in a single JSON array. */
  ingredients?: Ingredient[];
  ingredientsAt?: string;
}

const EMPTY_STASH: Stash = { recipes: {}, meals: {} };

function readStash(): Stash {
  if (typeof localStorage === "undefined") return EMPTY_STASH;
  try {
    const raw = localStorage.getItem(STASH_KEY);
    if (!raw) return EMPTY_STASH;
    const parsed = JSON.parse(raw) as Stash;
    return { ...EMPTY_STASH, ...parsed };
  } catch {
    // A corrupt stash must not brick the app — drop it and carry on.
    return EMPTY_STASH;
  }
}

function writeStash(stash: Stash): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STASH_KEY, JSON.stringify(stash));
}

export function clearStash(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STASH_KEY);
}

export function stashedCount(): number {
  const stash = readStash();
  return (
    Object.keys(stash.recipes).length +
    Object.keys(stash.meals).length +
    (stash.ingredients ? 1 : 0)
  );
}

/** Newer of two ISO timestamps, treating a missing one as oldest. */
function isNewer(a: string | undefined, b: string | undefined): boolean {
  if (!a) return false;
  if (!b) return true;
  return a > b;
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export interface LoadResult {
  data: Cookbook;
  /** How many local edits have not yet appeared in the published build. */
  pending: number;
  error?: string;
}

export async function loadCookbook(): Promise<LoadResult> {
  let published: Cookbook = { ingredients: [], recipes: [], meals: [], pantry: [] };
  let error: string | undefined;

  try {
    const res = await fetch("/data/all.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`Could not load cookbook data (${res.status}).`);
    const raw = (await res.json()) as unknown;
    published = parseBundle(raw);
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load cookbook data.";
  }

  const stash = readStash();
  const merged = applyStash(published, stash);
  return { data: merged.data, pending: merged.pending, error };
}

function parseBundle(raw: unknown): Cookbook {
  const bundle = raw as Partial<Record<keyof Cookbook, unknown[]>>;
  const safe = <T>(items: unknown[] | undefined, parse: (v: unknown) => T): T[] => {
    if (!Array.isArray(items)) return [];
    const out: T[] = [];
    for (const item of items) {
      // Skip individually invalid records rather than losing the whole file.
      try {
        out.push(parse(item));
      } catch {
        /* ignore */
      }
    }
    return out;
  };

  return {
    ingredients: safe(bundle.ingredients, (v) => IngredientSchema.parse(v)),
    recipes: safe(bundle.recipes, (v) => RecipeSchema.parse(v)),
    meals: safe(bundle.meals, (v) => MealSchema.parse(v)),
    pantry: safe(bundle.pantry, (v) => PantryItemSchema.parse(v)),
  };
}

/**
 * Lay local edits over the published build, dropping any the build has caught
 * up with.
 *
 * "Caught up" is decided by `updatedAt`: once the published copy is at least
 * as new as the stashed one, the edit has landed and the stash entry is
 * rubbish. Keeping it would mean a local copy shadowing later edits made
 * from another device forever.
 */
export function mergeStash(
  published: Cookbook,
  stash: Stash,
): { data: Cookbook; keep: Stash; pending: number } {
  let pending = 0;
  const nextStash: Stash = { recipes: {}, meals: {} };

  const recipes = new Map(published.recipes.map((r) => [r.id, r]));
  for (const [id, local] of Object.entries(stash.recipes)) {
    if (isNewer(local.updatedAt, recipes.get(id)?.updatedAt)) {
      recipes.set(id, local);
      nextStash.recipes[id] = local;
      pending++;
    }
  }

  const meals = new Map(published.meals.map((m) => [m.id, m]));
  for (const [id, local] of Object.entries(stash.meals)) {
    if (isNewer(local.updatedAt, meals.get(id)?.updatedAt)) {
      meals.set(id, local);
      nextStash.meals[id] = local;
      pending++;
    }
  }

  // Ingredients are one file, so the comparison is file-level: keep the local
  // list only while it is strictly larger or the published one has not moved.
  let ingredients = published.ingredients;
  if (stash.ingredients && stash.ingredientsAt) {
    const publishedIds = new Set(published.ingredients.map((i) => i.id));
    const unpublished = stash.ingredients.filter((i) => !publishedIds.has(i.id));
    if (unpublished.length > 0) {
      ingredients = [...published.ingredients, ...unpublished];
      nextStash.ingredients = stash.ingredients;
      nextStash.ingredientsAt = stash.ingredientsAt;
      pending++;
    }
  }

  return {
    data: {
      ingredients,
      recipes: [...recipes.values()].sort((a, b) => a.title.localeCompare(b.title)),
      meals: [...meals.values()].sort((a, b) => a.name.localeCompare(b.name)),
      pantry: published.pantry,
    },
    keep: nextStash,
    pending,
  };
}

/** mergeStash plus the localStorage write-back of what is still pending. */
function applyStash(published: Cookbook, stash: Stash): { data: Cookbook; pending: number } {
  const { data, keep, pending } = mergeStash(published, stash);
  writeStash(keep);
  return { data, pending };
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export interface SaveResult {
  committed: boolean;
  url?: string;
  error?: string;
}

/**
 * Save a recipe, plus any ingredients it introduced, as ONE commit.
 *
 * The local stash is written first and unconditionally: if the network call
 * fails, the work is still on screen and still recoverable rather than lost
 * because GitHub was briefly unreachable.
 */
export async function saveRecipe(
  recipe: Recipe,
  allIngredients: Ingredient[],
  options: { ingredientsChanged: boolean },
): Promise<SaveResult> {
  const stamped: Recipe = { ...recipe, updatedAt: new Date().toISOString() };

  const stash = readStash();
  stash.recipes[stamped.id] = stamped;
  if (options.ingredientsChanged) {
    stash.ingredients = allIngredients;
    stash.ingredientsAt = stamped.updatedAt;
  }
  writeStash(stash);

  const cfg = getRepoConfig();
  if (!cfg) return { committed: false, error: "No token — saved locally only." };

  const changes = [{ path: paths.recipe(stamped.id), content: serialise(stamped) }];
  if (options.ingredientsChanged) {
    changes.push({ path: paths.ingredients(), content: serialise(allIngredients) });
  }

  try {
    const result = await commitFiles(cfg, `Update recipe: ${stamped.title}`, changes);
    return { committed: true, url: result.url };
  } catch (e) {
    return { committed: false, error: e instanceof Error ? e.message : "Commit failed." };
  }
}

export async function saveMeal(meal: Meal): Promise<SaveResult> {
  const stamped: Meal = { ...meal, updatedAt: new Date().toISOString() };

  const stash = readStash();
  stash.meals[stamped.id] = stamped;
  writeStash(stash);

  const cfg = getRepoConfig();
  if (!cfg) return { committed: false, error: "No token — saved locally only." };

  try {
    const result = await commitFiles(cfg, `Update meal: ${stamped.name}`, [
      { path: paths.meal(stamped.id), content: serialise(stamped) },
    ]);
    return { committed: true, url: result.url };
  } catch (e) {
    return { committed: false, error: e instanceof Error ? e.message : "Commit failed." };
  }
}

export async function deleteRecipe(recipe: Recipe): Promise<SaveResult> {
  const stash = readStash();
  delete stash.recipes[recipe.id];
  writeStash(stash);

  const cfg = getRepoConfig();
  if (!cfg) return { committed: false, error: "No token — nothing was deleted." };

  try {
    const result = await commitFiles(cfg, `Delete recipe: ${recipe.title}`, [
      { path: paths.recipe(recipe.id), content: null },
    ]);
    return { committed: true, url: result.url };
  } catch (e) {
    return { committed: false, error: e instanceof Error ? e.message : "Delete failed." };
  }
}

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

/** Kebab-case slug matching the schema's id pattern. */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Append -2, -3 … until the slug is free. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const existing = new Set(taken);
  const slug = slugify(base) || "untitled";
  if (!existing.has(slug)) return slug;
  let n = 2;
  while (existing.has(`${slug}-${n}`)) n++;
  return `${slug}-${n}`;
}
