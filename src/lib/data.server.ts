/**
 * Build-time data loading.
 *
 * NODE ONLY — uses node:fs, so it must never be imported from a React island
 * or anything that reaches the browser bundle. The `.server` suffix is the
 * reminder. Client-side code fetches /data/*.json over HTTP instead.
 *
 * Everything is validated on load rather than cast. These files are
 * hand-written today and browser-written tomorrow, and a malformed record
 * should fail the build loudly instead of quietly producing a wrong list.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  IngredientsFileSchema,
  MealSchema,
  PantryFileSchema,
  RecipeSchema,
  type Ingredient,
  type Meal,
  type PantryItem,
  type Recipe,
} from "./schema";

const DATA_DIR = join(process.cwd(), "public", "data");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listJson(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

export function loadIngredients(): Ingredient[] {
  const path = join(DATA_DIR, "ingredients.json");
  if (!existsSync(path)) return [];
  return IngredientsFileSchema.parse(readJson(path));
}

export function loadRecipes(): Recipe[] {
  const dir = join(DATA_DIR, "recipes");
  return listJson(dir)
    .map((file) => {
      try {
        return RecipeSchema.parse(readJson(join(dir, file)));
      } catch (error) {
        throw new Error(`Invalid recipe in ${file}: ${(error as Error).message}`);
      }
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function loadMeals(): Meal[] {
  const dir = join(DATA_DIR, "meals");
  return listJson(dir)
    .map((file) => {
      try {
        return MealSchema.parse(readJson(join(dir, file)));
      } catch (error) {
        throw new Error(`Invalid meal in ${file}: ${(error as Error).message}`);
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function loadPantry(): PantryItem[] {
  const path = join(DATA_DIR, "pantry.json");
  if (!existsSync(path)) return [];
  return PantryFileSchema.parse(readJson(path));
}

/** Everything at once, plus lookup maps. Most pages want this. */
export function loadAll() {
  const ingredients = loadIngredients();
  const recipes = loadRecipes();
  const meals = loadMeals();
  return {
    ingredients,
    recipes,
    meals,
    pantry: loadPantry(),
    ingredientsById: new Map(ingredients.map((i) => [i.id, i])),
    recipesById: new Map(recipes.map((r) => [r.id, r])),
    mealsById: new Map(meals.map((m) => [m.id, m])),
  };
}

/** Every distinct tag across recipes, most-used first. */
export function collectTags(recipes: Recipe[]): string[] {
  const counts = new Map<string, number>();
  for (const recipe of recipes) {
    for (const tag of recipe.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

/** "1 hr 25 min", "45 min", or null when there is no time to show. */
export function formatMinutes(total: number): string | null {
  if (!total || total <= 0) return null;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

/** Active time only — rest/chill is excluded, since it needs no attention. */
export function activeMinutes(recipe: Recipe): number {
  return recipe.prepMin + recipe.cookMin;
}
