/**
 * The shopping list's own contents: parsing what people type, and the edits
 * the server applies. A wrong parse is a wrong shopping quantity, so the
 * registry matching in particular is pinned down here.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addDish,
  addItem,
  applyListEdit,
  describeItem,
  emptyExtras,
  matchIngredient,
  parseItem,
} from "./list";
import { IngredientsFileSchema, type ShoppingExtras } from "./schema";

const INGREDIENTS = IngredientsFileSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), "seed", "ingredients.json"), "utf8")),
);
const byId = new Map(INGREDIENTS.map((i) => [i.id, i]));
const match = (text: string) => matchIngredient(text, INGREDIENTS)?.id;

describe("matching typed text to the ingredient registry", () => {
  it("matches names, plurals and aliases", () => {
    expect(match("ground beef")).toBe("ground-beef");
    expect(match("hamburger")).toBe("ground-beef");
    expect(match("Eggs")).toBe("egg");
    expect(match("mayo")).toBe("mayonnaise");
    expect(match("tomatoes")).toBe("tomato");
    expect(match("lemons")).toBe("lemon");
  });

  it("lets a name with extra leading words stand in", () => {
    // "shredded low-moisture mozzarella" is the registry name.
    expect(match("mozzarella")).toBe("mozzarella");
    expect(match("bell peppers")).toBe("bell-pepper");
  });

  it("prefers an exact alias over a longer name that merely ends the same way", () => {
    // "pepper" is black pepper's alias, even though "bell pepper" ends in it.
    expect(match("pepper")).toBe("black-pepper");
  });

  it("refuses to guess between two equally good matches", () => {
    // Olive oil or neutral oil? A wrong merge is worse than a loose line.
    expect(match("oil")).toBeUndefined();
    expect(match("cheese")).toBeUndefined();
  });

  it("leaves things the registry does not know alone", () => {
    expect(match("paper towels")).toBeUndefined();
    expect(match("milk")).toBeUndefined();
  });
});

describe("parseItem", () => {
  const parse = (text: string) => parseItem(text, INGREDIENTS);

  it("reads a quantity, a unit and an ingredient", () => {
    expect(parse("2 lb ground beef")).toEqual({ ingredientId: "ground-beef", quantity: 2, unit: "lb" });
    expect(parse("1/2 cup mayo")).toEqual({ ingredientId: "mayonnaise", quantity: 0.5, unit: "cup" });
    expect(parse("1 1/2 cups of white rice")).toEqual({
      ingredientId: "white-rice",
      quantity: 1.5,
      unit: "cup",
    });
    expect(parse("½ tsp paprika")).toEqual({ ingredientId: "paprika", quantity: 0.5, unit: "tsp" });
    expect(parse("1½ lb potatoes")).toEqual({ ingredientId: "potato", quantity: 1.5, unit: "lb" });
  });

  it("counts a bare number in the ingredient's own count unit, else each", () => {
    expect(parse("3 lemons")).toEqual({ ingredientId: "lemon", quantity: 3, unit: "each" });
    expect(parse("4 garlic")).toEqual({ ingredientId: "garlic", quantity: 4, unit: "clove" });
    expect(parse("2 tomato sauce")).toEqual({ ingredientId: "tomato-sauce", quantity: 2, unit: "can" });
  });

  it("takes no quantity at all as just the thing", () => {
    expect(parse("eggs")).toEqual({ ingredientId: "egg", quantity: undefined, unit: undefined });
  });

  it("keeps unknown things as free text, amount and all", () => {
    expect(parse("paper towels")).toEqual({ name: "paper towels", quantity: undefined, unit: undefined });
    expect(parse("2 gal milk")).toEqual({ name: "milk", quantity: 2, unit: "gal" });
  });

  it("does not eat the name when the only word after the number is a unit", () => {
    // "2 cans" is two of a thing called cans, not two cans of nothing.
    expect(parse("2 cans")).toEqual({ name: "cans", quantity: 2, unit: "each" });
  });

  it("ignores blank input", () => {
    expect(parse("   ")).toBeNull();
  });
});

describe("addItem", () => {
  const base = (): ShoppingExtras => emptyExtras();

  it("sums the same ingredient in the same unit", () => {
    let list = addItem(base(), { ingredientId: "egg", quantity: 6, unit: "each" }, "a");
    list = addItem(list, { ingredientId: "egg", quantity: 6, unit: "each" }, "b");
    expect(list.items).toEqual([{ id: "a", ingredientId: "egg", quantity: 12, unit: "each" }]);
  });

  it("converts within a dimension", () => {
    let list = addItem(base(), { ingredientId: "ground-beef", quantity: 1, unit: "lb" }, "a");
    list = addItem(list, { ingredientId: "ground-beef", quantity: 8, unit: "oz" }, "b");
    expect(list.items).toHaveLength(1);
    expect(list.items[0].quantity).toBeCloseTo(1.5, 6);
    expect(list.items[0].unit).toBe("lb");
  });

  it("gives a bare item an amount when one arrives later, and ignores a bare repeat", () => {
    let list = addItem(base(), { ingredientId: "egg" }, "a");
    list = addItem(list, { ingredientId: "egg", quantity: 12, unit: "each" }, "b");
    list = addItem(list, { ingredientId: "egg" }, "c");
    expect(list.items).toEqual([{ id: "a", ingredientId: "egg", quantity: 12, unit: "each" }]);
  });

  it("keeps incompatible units apart rather than guessing", () => {
    let list = addItem(base(), { ingredientId: "garlic", quantity: 1, unit: "head" }, "a");
    list = addItem(list, { ingredientId: "garlic", quantity: 4, unit: "clove" }, "b");
    expect(list.items).toHaveLength(2);
  });

  it("merges free text case-insensitively", () => {
    let list = addItem(base(), { name: "Paper towels" }, "a");
    list = addItem(list, { name: "paper  towels" }, "b");
    expect(list.items).toHaveLength(1);
  });
});

describe("dishes", () => {
  it("sets servings when the same recipe is added again, rather than listing it twice", () => {
    let list = addDish(emptyExtras(), { recipeId: "falafel", servings: 4 });
    list = addDish(list, { recipeId: "falafel", servings: 8 });
    expect(list.dishes).toEqual([{ recipeId: "falafel", servings: 8 }]);
  });

  it("treats a meal and a recipe with the same slug as different things", () => {
    let list = addDish(emptyExtras(), { recipeId: "greek-dinner" });
    list = addDish(list, { mealId: "greek-dinner" });
    expect(list.dishes).toHaveLength(2);
  });
});

describe("applyListEdit", () => {
  it("round-trips the plan choice, including back to automatic", () => {
    let list = applyListEdit(emptyExtras(), { type: "setPlan", planId: null });
    expect(list.planId).toBeNull();
    list = applyListEdit(list, { type: "setPlan", planId: "week-2026-09-28" });
    expect(list.planId).toBe("week-2026-09-28");
    list = applyListEdit(list, { type: "setPlan", planId: "auto" });
    expect("planId" in list).toBe(false);
  });

  it("clears dishes and items but keeps the plan choice", () => {
    let list = applyListEdit(emptyExtras(), { type: "setPlan", planId: null });
    list = applyListEdit(list, { type: "addDish", dish: { recipeId: "falafel" } });
    list = applyListEdit(list, { type: "addItem", item: { name: "milk" } }, "x");
    list = applyListEdit(list, { type: "clear" });
    expect(list).toEqual({ dishes: [], items: [], planId: null });
  });

  it("removes an item by id", () => {
    let list = applyListEdit(emptyExtras(), { type: "addItem", item: { name: "milk" } }, "x");
    list = applyListEdit(list, { type: "removeItem", id: "x" });
    expect(list.items).toEqual([]);
  });
});

describe("describeItem", () => {
  it("reads like a list line", () => {
    expect(describeItem({ id: "a", ingredientId: "ground-beef", quantity: 2, unit: "lb" }, byId)).toBe(
      "2 lb ground beef",
    );
    expect(describeItem({ id: "a", ingredientId: "egg", quantity: 12, unit: "each" }, byId)).toBe(
      "12 large eggs",
    );
    expect(describeItem({ id: "a", ingredientId: "egg" }, byId)).toBe("large eggs");
    expect(describeItem({ id: "a", name: "paper towels" }, byId)).toBe("paper towels");
  });
});
