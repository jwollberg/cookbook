import { describe, it, expect } from "vitest";
import { buildShoppingList, expandPlan, type ResolvedDish } from "./shopping";
import { scaleIngredients } from "./scaling";
import type { Ingredient, Meal, MealPlan, Recipe } from "./schema";

// --- fixtures --------------------------------------------------------------

const ing = (over: Partial<Ingredient> & { id: string; name: string }): Ingredient => ({
  aisle: "other",
  aliases: [],
  isStaple: false,
  ...over,
});

const FLOUR = ing({ id: "flour", name: "flour", aisle: "pantry", gramsPerMl: 0.53 });
const OLIVE_OIL = ing({ id: "olive-oil", name: "olive oil", aisle: "pantry", gramsPerMl: 0.918 });
const GARLIC = ing({
  id: "garlic",
  name: "garlic",
  aisle: "produce",
  countWeights: { clove: 5, head: 45 },
});
// Deliberately has NO conversion factors — drives the "don't guess" path.
const CHICKEN = ing({ id: "chicken", name: "chicken breast", aisle: "meat" });
const SALT = ing({ id: "salt", name: "sea salt", aisle: "spices", isStaple: true });

const INGREDIENTS = new Map(
  [FLOUR, OLIVE_OIL, GARLIC, CHICKEN, SALT].map((i) => [i.id, i]),
);

const recipe = (over: Partial<Recipe> & { id: string; title: string }): Recipe => ({
  servings: 4,
  prepMin: 0,
  cookMin: 0,
  restMin: 0,
  tags: [],
  ingredients: [],
  steps: [],
  ...over,
});

const line = (ingredientId: string, quantity: number, unit: string, extra = {}) => ({
  ingredientId,
  quantity,
  unit,
  optional: false,
  noScale: false,
  ...extra,
});

// --- the canonical case ----------------------------------------------------

describe("merging across units", () => {
  it("merges cups and grams of flour into ONE line", () => {
    // The case the whole app exists to get right.
    const dishes: ResolvedDish[] = [
      { recipe: recipe({ id: "a", title: "A", ingredients: [line("flour", 2, "cup")] }) },
      { recipe: recipe({ id: "b", title: "B", ingredients: [line("flour", 250, "g")] }) },
    ];

    const list = buildShoppingList(dishes, INGREDIENTS);
    const flour = list.groups.flatMap((g) => g.lines).find((l) => l.ingredientId === "flour")!;

    expect(flour.parts).toHaveLength(1);
    expect(flour.parts[0].bucket).toBe("mass");
    // 2 cups = 473.176 ml * 0.53 g/ml = 250.78 g, plus 250 g.
    expect(flour.parts[0].baseAmount).toBeCloseTo(500.78, 1);
    expect(flour.fromRecipes.sort()).toEqual(["A", "B"]);
    expect(list.splitLines).not.toContain("flour");
  });

  it("keeps a single-dimension total in its own unit rather than forcing grams", () => {
    const dishes: ResolvedDish[] = [
      { recipe: recipe({ id: "a", title: "A", ingredients: [line("olive-oil", 1, "tbsp")] }) },
      { recipe: recipe({ id: "b", title: "B", ingredients: [line("olive-oil", 1, "tbsp")] }) },
    ];

    const oil = buildShoppingList(dishes, INGREDIENTS)
      .groups.flatMap((g) => g.lines)
      .find((l) => l.ingredientId === "olive-oil")!;

    expect(oil.parts).toHaveLength(1);
    expect(oil.parts[0].bucket).toBe("volume");
  });

  it("SPLITS rather than guessing when a factor is missing", () => {
    const dishes: ResolvedDish[] = [
      { recipe: recipe({ id: "a", title: "A", ingredients: [line("chicken", 500, "g")] }) },
      { recipe: recipe({ id: "b", title: "B", ingredients: [line("chicken", 2, "each")] }) },
    ];

    const list = buildShoppingList(dishes, INGREDIENTS);
    const chicken = list.groups.flatMap((g) => g.lines).find((l) => l.ingredientId === "chicken")!;

    // "500 g chicken" AND "2 chicken" — never an invented single number.
    expect(chicken.parts).toHaveLength(2);
    expect(list.splitLines).toContain("chicken");
  });

  it("does not merge different count units of the same ingredient without weights", () => {
    const noWeights = new Map(INGREDIENTS);
    noWeights.set("garlic", ing({ id: "garlic", name: "garlic", aisle: "produce" }));

    const dishes: ResolvedDish[] = [
      { recipe: recipe({ id: "a", title: "A", ingredients: [line("garlic", 4, "clove")] }) },
      { recipe: recipe({ id: "b", title: "B", ingredients: [line("garlic", 1, "head")] }) },
    ];

    const garlic = buildShoppingList(dishes, noWeights)
      .groups.flatMap((g) => g.lines)
      .find((l) => l.ingredientId === "garlic")!;

    expect(garlic.parts).toHaveLength(2);
  });

  it("sums the same count unit across recipes", () => {
    const dishes: ResolvedDish[] = [
      { recipe: recipe({ id: "a", title: "A", ingredients: [line("garlic", 4, "clove")] }) },
      { recipe: recipe({ id: "b", title: "B", ingredients: [line("garlic", 5, "clove")] }) },
      { recipe: recipe({ id: "c", title: "C", ingredients: [line("garlic", 2, "clove")] }) },
    ];

    const garlic = buildShoppingList(dishes, INGREDIENTS)
      .groups.flatMap((g) => g.lines)
      .find((l) => l.ingredientId === "garlic")!;

    expect(garlic.parts).toHaveLength(1);
    expect(garlic.parts[0].baseAmount).toBe(11);
    expect(garlic.parts[0].text).toBe("11 cloves");
  });
});

// --- scaling ---------------------------------------------------------------

describe("scaling", () => {
  it("scales quantities by target servings", () => {
    const r = recipe({
      id: "a",
      title: "A",
      servings: 4,
      ingredients: [line("flour", 200, "g")],
    });
    expect(scaleIngredients(r, 8)[0].quantity).toBe(400);
    expect(scaleIngredients(r, 2)[0].quantity).toBe(100);
    expect(scaleIngredients(r, undefined)[0].quantity).toBe(200);
  });

  it("holds noScale lines fixed", () => {
    // Doubling the batch does not double the oil in the frying pan.
    const r = recipe({
      id: "a",
      title: "A",
      servings: 4,
      ingredients: [line("olive-oil", 3, "tbsp", { noScale: true })],
    });
    expect(scaleIngredients(r, 12)[0].quantity).toBe(3);
  });

  it("scales BEFORE summing, not after", () => {
    const dishes: ResolvedDish[] = [
      {
        recipe: recipe({ id: "a", title: "A", servings: 4, ingredients: [line("flour", 100, "g")] }),
        servings: 8, // x2 -> 200 g
      },
      {
        recipe: recipe({ id: "b", title: "B", servings: 4, ingredients: [line("flour", 100, "g")] }),
        servings: 2, // x0.5 -> 50 g
      },
    ];

    const flour = buildShoppingList(dishes, INGREDIENTS)
      .groups.flatMap((g) => g.lines)
      .find((l) => l.ingredientId === "flour")!;

    // 250 g. Summing first (200 g) then scaling by either factor gives 400 or
    // 100 — both wrong, which is why the order is fixed.
    expect(flour.parts[0].baseAmount).toBeCloseTo(250, 6);
  });
});

// --- pantry, staples, aisles ----------------------------------------------

describe("pantry and staples", () => {
  it("subtracts what is already on hand", () => {
    const dishes: ResolvedDish[] = [
      { recipe: recipe({ id: "a", title: "A", ingredients: [line("flour", 500, "g")] }) },
    ];

    const flour = buildShoppingList(dishes, INGREDIENTS, {
      pantry: [{ ingredientId: "flour", quantity: 200, unit: "g" }],
    })
      .groups.flatMap((g) => g.lines)
      .find((l) => l.ingredientId === "flour")!;

    expect(flour.parts[0].baseAmount).toBeCloseTo(300, 6);
  });

  it("marks an ingredient fully covered by the pantry rather than listing it", () => {
    const dishes: ResolvedDish[] = [
      { recipe: recipe({ id: "a", title: "A", ingredients: [line("flour", 200, "g")] }) },
    ];

    const flour = buildShoppingList(dishes, INGREDIENTS, {
      pantry: [{ ingredientId: "flour", quantity: 500, unit: "g" }],
    })
      .groups.flatMap((g) => g.lines)
      .find((l) => l.ingredientId === "flour")!;

    expect(flour.covered).toBe(true);
    expect(flour.parts).toHaveLength(0);
  });

  it("keeps staples off the list by default but can include them", () => {
    const dishes: ResolvedDish[] = [
      { recipe: recipe({ id: "a", title: "A", ingredients: [line("salt", 2, "tsp")] }) },
    ];

    const without = buildShoppingList(dishes, INGREDIENTS);
    expect(without.groups.flatMap((g) => g.lines)).toHaveLength(0);

    const with_ = buildShoppingList(dishes, INGREDIENTS, { includeStaples: true });
    expect(with_.groups.flatMap((g) => g.lines)).toHaveLength(1);
  });

  it("excludes optional ingredients", () => {
    const dishes: ResolvedDish[] = [
      {
        recipe: recipe({
          id: "a",
          title: "A",
          ingredients: [line("flour", 100, "g", { optional: true })],
        }),
      },
    ];
    expect(buildShoppingList(dishes, INGREDIENTS).totalLines).toBe(0);
  });

  it("groups by aisle in store-walking order, not alphabetically", () => {
    const dishes: ResolvedDish[] = [
      {
        recipe: recipe({
          id: "a",
          title: "A",
          ingredients: [line("flour", 100, "g"), line("garlic", 2, "clove"), line("chicken", 1, "lb")],
        }),
      },
    ];

    const aisles = buildShoppingList(dishes, INGREDIENTS).groups.map((g) => g.aisle);
    expect(aisles).toEqual(["produce", "meat", "pantry"]);
  });
});

// --- plan expansion --------------------------------------------------------

describe("expandPlan", () => {
  const potatoes = recipe({ id: "potatoes", title: "Potatoes", servings: 6 });
  const falafel = recipe({ id: "falafel", title: "Falafel", servings: 4 });
  const recipes = new Map([potatoes, falafel].map((r) => [r.id, r]));

  const meal: Meal = {
    id: "greek",
    name: "Greek Dinner",
    tags: [],
    timeline: [],
    components: [
      { recipeId: "falafel", role: "main" },
      { recipeId: "potatoes", role: "side" },
    ],
  };
  const meals = new Map([[meal.id, meal]]);

  it("expands a meal into its component recipes", () => {
    const plan: MealPlan = {
      id: "p",
      name: "P",
      days: [{ date: "2026-08-12", entries: [{ slot: "dinner", mealId: "greek" }] }],
    };
    const dishes = expandPlan(plan, recipes, meals);
    expect(dishes.map((d) => d.recipe.id).sort()).toEqual(["falafel", "potatoes"]);
  });

  it("passes plan servings down to every component", () => {
    const plan: MealPlan = {
      id: "p",
      name: "P",
      days: [{ date: "2026-08-12", entries: [{ slot: "dinner", mealId: "greek", servings: 8 }] }],
    };
    expect(expandPlan(plan, recipes, meals).every((d) => d.servings === 8)).toBe(true);
  });

  it("lets a component override win over the plan servings", () => {
    const withOverride: Meal = {
      ...meal,
      components: [{ recipeId: "potatoes", role: "side", servingsOverride: 12 }],
    };
    const plan: MealPlan = {
      id: "p",
      name: "P",
      days: [{ date: "2026-08-12", entries: [{ slot: "dinner", mealId: "greek", servings: 8 }] }],
    };
    const dishes = expandPlan(plan, recipes, new Map([["greek", withOverride]]));
    expect(dishes[0].servings).toBe(12);
  });

  it("handles standalone recipe entries and skips dangling references", () => {
    const plan: MealPlan = {
      id: "p",
      name: "P",
      days: [
        {
          date: "2026-08-12",
          entries: [
            { slot: "lunch", recipeId: "falafel" },
            { slot: "dinner", recipeId: "does-not-exist" },
            { slot: "dinner", mealId: "no-such-meal" },
          ],
        },
      ],
    };
    const dishes = expandPlan(plan, recipes, meals);
    expect(dishes).toHaveLength(1);
    expect(dishes[0].recipe.id).toBe("falafel");
  });

  it("accumulates the same recipe appearing on multiple days", () => {
    const plan: MealPlan = {
      id: "p",
      name: "P",
      days: [
        { date: "2026-08-12", entries: [{ slot: "dinner", recipeId: "falafel" }] },
        { date: "2026-08-13", entries: [{ slot: "dinner", recipeId: "falafel" }] },
      ],
    };
    expect(expandPlan(plan, recipes, meals)).toHaveLength(2);
  });
});
