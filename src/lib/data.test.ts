/**
 * Integrity checks on the real contents of public/data.
 *
 * The repo is the database, so these files are hand-written today and
 * browser-written tomorrow. Schema validation catches malformed records;
 * the referential checks catch the failure that actually bites — a recipe
 * pointing at an ingredient id that does not exist, which would silently
 * vanish from every shopping list rather than erroring.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  IngredientsFileSchema,
  MealSchema,
  PantryFileSchema,
  RecipeSchema,
  type Ingredient,
  type Meal,
  type MealPlan,
  type Recipe,
} from "./schema";
import { buildShoppingList, expandPlan } from "./shopping";

const DATA = join(process.cwd(), "public", "data");
const PUBLIC = join(process.cwd(), "public");

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const listJson = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];

const ingredients: Ingredient[] = IngredientsFileSchema.parse(readJson(join(DATA, "ingredients.json")));
const ingredientIds = new Set(ingredients.map((i) => i.id));

const recipes: Recipe[] = listJson(join(DATA, "recipes")).map((f) =>
  RecipeSchema.parse(readJson(join(DATA, "recipes", f))),
);
const recipeIds = new Set(recipes.map((r) => r.id));

const meals: Meal[] = listJson(join(DATA, "meals")).map((f) =>
  MealSchema.parse(readJson(join(DATA, "meals", f))),
);

describe("seed data", () => {
  it("has ingredients, recipes and meals", () => {
    expect(ingredients.length).toBeGreaterThan(0);
    expect(recipes.length).toBeGreaterThan(0);
    expect(meals.length).toBeGreaterThan(0);
  });

  it("parses pantry.json", () => {
    expect(() => PantryFileSchema.parse(readJson(join(DATA, "pantry.json")))).not.toThrow();
  });

  it("has no duplicate ingredient ids", () => {
    expect(ingredientIds.size).toBe(ingredients.length);
  });

  it("names every recipe file after the id inside it", () => {
    for (const file of listJson(join(DATA, "recipes"))) {
      const recipe = readJson(join(DATA, "recipes", file));
      expect(`${recipe.id}.json`).toBe(file);
    }
  });
});

describe("referential integrity", () => {
  it("resolves every ingredient referenced by a recipe", () => {
    const dangling: string[] = [];
    for (const recipe of recipes) {
      for (const line of recipe.ingredients) {
        if (!ingredientIds.has(line.ingredientId)) {
          dangling.push(`${recipe.id} -> ${line.ingredientId}`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });

  it("resolves every recipe referenced by a meal", () => {
    const dangling: string[] = [];
    for (const meal of meals) {
      for (const component of meal.components) {
        if (!recipeIds.has(component.recipeId)) {
          dangling.push(`${meal.id} -> ${component.recipeId}`);
        }
      }
      for (const step of meal.timeline) {
        if (step.recipeId && !recipeIds.has(step.recipeId)) {
          dangling.push(`${meal.id} timeline -> ${step.recipeId}`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });
});

/**
 * End-to-end check against a human-made list.
 *
 * The Greek dinner arrived with its own hand-written master grocery list, so
 * these numbers are ground truth produced independently of this code. If the
 * engine and the cook disagree, the engine is wrong.
 */
describe("Greek dinner vs. the hand-written master list", () => {
  const recipesById = new Map(recipes.map((r) => [r.id, r]));
  const mealsById = new Map(meals.map((m) => [m.id, m]));

  const plan: MealPlan = {
    id: "test",
    name: "Test",
    days: [{ date: "2026-08-12", entries: [{ slot: "dinner", mealId: "greek-dinner" }] }],
  };

  const dishes = expandPlan(plan, recipesById, mealsById);
  const list = buildShoppingList(dishes, new Map(ingredients.map((i) => [i.id, i])));
  const lines = new Map(list.groups.flatMap((g) => g.lines).map((l) => [l.ingredientId, l]));

  it("pulls in all four component recipes", () => {
    expect(dishes).toHaveLength(4);
  });

  it("merges garlic across the potatoes, falafel and tzatziki", () => {
    // 4 + 5 + 2 cloves. The cook wrote "2 heads of garlic"; 11 cloves is ~1.2
    // heads, so buying 2 is right.
    expect(lines.get("garlic")!.parts[0].baseAmount).toBe(11);
    expect(lines.get("garlic")!.fromRecipes).toHaveLength(3);
  });

  it("merges olive oil across three recipes to about a cup", () => {
    // 1/2 cup + 1/4 cup + 1 tbsp. The cook wrote "approx. 1 cup total".
    expect(lines.get("olive-oil")!.parts[0].baseAmount).toBeCloseTo(192.23, 1);
  });

  it("totals cucumber across tzatziki and the salad", () => {
    // 1/2 + 1 = 1.5, which is why the cook wrote "2 English cucumbers".
    expect(lines.get("english-cucumber")!.parts[0].baseAmount).toBe(1.5);
  });

  it("keeps salt and pepper off the list as staples", () => {
    expect(lines.has("sea-salt")).toBe(false);
    expect(lines.has("black-pepper")).toBe(false);
  });

  it("needs no guesses — nothing had to be split", () => {
    // A non-empty splitLines here would mean an ingredient is missing a
    // gramsPerMl or countWeights entry it needs.
    expect(list.splitLines).toEqual([]);
  });

  it("puts produce first and spices last", () => {
    const aisles = list.groups.map((g) => g.aisle);
    expect(aisles[0]).toBe("produce");
    expect(aisles[aisles.length - 1]).toBe("spices");
  });
});

describe("images", () => {
  it("points every recipe image at a file that exists", () => {
    const missing = recipes
      .filter((r) => r.image)
      .filter((r) => !existsSync(join(PUBLIC, r.image!.replace(/^\//, ""))))
      .map((r) => `${r.id}: ${r.image}`);
    expect(missing).toEqual([]);
  });

  it("carries attribution for every image", () => {
    // CC BY and CC BY-SA both REQUIRE credit. An image without it is a
    // licence violation waiting to ship, so fail the build instead.
    const uncredited = recipes
      .filter((r) => r.image && !r.imageCredit?.author)
      .map((r) => r.id);
    expect(uncredited).toEqual([]);
  });
});
