import { describe, it, expect } from "vitest";
import { buildShoppingList, type ResolvedDish } from "./shopping";
import { formatMoney, packagesOf, priceList, recipeCost } from "./pricing";
import type { Ingredient, Recipe } from "./schema";

const ing = (over: Partial<Ingredient> & { id: string; name: string }): Ingredient => ({
  aisle: "other",
  aliases: [],
  isStaple: false,
  ...over,
});

const BEEF = ing({ id: "beef", name: "ground beef", aisle: "meat", price: { amount: 5.5, quantity: 1, unit: "lb" } });
// Sold in a 24 oz jar, used by the cup: converts through its density.
const SAUCE = ing({
  id: "sauce",
  name: "pasta sauce",
  aisle: "pantry",
  gramsPerMl: 1.03,
  price: { amount: 1.98, quantity: 24, unit: "oz" },
});
// Priced by the jar, used by the jar: no conversion needed.
const SALSA = ing({ id: "salsa", name: "salsa", aisle: "pantry", price: { amount: 2.5, quantity: 1, unit: "jar" } });
// Priced per pound, used per egg with no weight for an egg: can't be priced honestly.
const EGG = ing({ id: "egg", name: "egg", aisle: "dairy", price: { amount: 3, quantity: 1, unit: "lb" } });
const CUMIN = ing({
  id: "cumin",
  name: "cumin",
  aisle: "spices",
  gramsPerMl: 0.5,
  price: { amount: 1.5, quantity: 2, unit: "oz" },
});
const NO_PRICE = ing({ id: "onion", name: "onion", aisle: "produce" });

const INGREDIENTS = new Map([BEEF, SAUCE, SALSA, EGG, CUMIN, NO_PRICE].map((i) => [i.id, i]));

const recipe = (over: Partial<Recipe> & Pick<Recipe, "id" | "ingredients">): Recipe => ({
  title: over.id,
  servings: 4,
  prepMin: 0,
  cookMin: 0,
  restMin: 0,
  tags: [],
  steps: [],
  ...over,
});

const line = (ingredientId: string, quantity: number, unit: string, optional = false) => ({
  ingredientId,
  quantity,
  unit,
  optional,
  noScale: false,
});

const CHILI = recipe({
  id: "chili",
  ingredients: [line("beef", 2, "lb"), line("sauce", 1, "cup"), line("cumin", 1, "tbsp"), line("onion", 1, "each")],
});
const TACOS = recipe({ id: "tacos", ingredients: [line("beef", 1.5, "lb"), line("salsa", 0.5, "jar")] });

const list = (dishes: ResolvedDish[]) => buildShoppingList(dishes, INGREDIENTS);

describe("packagesOf", () => {
  it("divides straight through when the units match", () => {
    expect(packagesOf(453.59237 * 3, "mass", BEEF.price!, BEEF)).toBeCloseTo(3);
  });

  it("converts volume to a weight-priced package through the density", () => {
    // 1 cup of sauce ≈ 243.7 g; a 24 oz jar is 680.4 g.
    expect(packagesOf(236.588, "volume", SAUCE.price!, SAUCE)).toBeCloseTo(243.69 / 680.39, 3);
  });

  it("refuses to guess when no factor connects the units", () => {
    expect(packagesOf(6, "count:each", EGG.price!, EGG)).toBeNull();
  });
});

describe("priceList", () => {
  it("buys whole packages across recipes", () => {
    const cost = priceList(list([{ recipe: CHILI }, { recipe: TACOS }]), INGREDIENTS);
    // 3.5 lb of beef is four 1 lb packs; half a jar of salsa is a jar.
    expect(cost.byLine.get("beef")).toMatchObject({ packages: 4, cost: 22 });
    expect(cost.byLine.get("salsa")).toMatchObject({ packages: 1, cost: 2.5 });
    expect(cost.byLine.get("sauce")).toMatchObject({ packages: 1, cost: 1.98 });
    expect(cost.total).toBeCloseTo(22 + 2.5 + 1.98 + 1.5);
  });

  it("does not buy an extra package for rounding dust", () => {
    const cost = priceList(list([{ recipe: recipe({ id: "x", ingredients: [line("beef", 2.0000001, "lb")] }) }]), INGREDIENTS);
    expect(cost.byLine.get("beef")?.packages).toBe(2);
  });

  it("counts unpriced lines instead of inventing a price", () => {
    const cost = priceList(list([{ recipe: CHILI }]), INGREDIENTS);
    expect(cost.byLine.has("onion")).toBe(false);
    expect(cost.unpriced).toBe(1);
  });

  it("keeps a running total of what's left once lines are ticked", () => {
    const cost = priceList(list([{ recipe: TACOS }]), INGREDIENTS, new Set(["beef"]));
    expect(cost.total).toBeCloseTo(11 + 2.5);
    expect(cost.left).toBeCloseTo(2.5);
  });
});

describe("recipeCost", () => {
  it("costs only the share of each package a recipe uses", () => {
    const cost = recipeCost(TACOS, INGREDIENTS);
    expect(cost.total).toBeCloseTo(1.5 * 5.5 + 0.5 * 2.5);
    expect(cost.perServing).toBeCloseTo(cost.total / 4);
  });

  it("scales with servings and lists what it couldn't price", () => {
    const base = recipeCost(CHILI, INGREDIENTS);
    const doubled = recipeCost(CHILI, INGREDIENTS, 8);
    expect(doubled.total).toBeCloseTo(base.total * 2);
    expect(base.unpriced).toEqual(["onion"]);
  });

  it("leaves optional lines out, as the list does", () => {
    const withOptional = recipe({ id: "y", ingredients: [line("beef", 1, "lb"), line("salsa", 1, "jar", true)] });
    expect(recipeCost(withOptional, INGREDIENTS).total).toBeCloseTo(5.5);
  });
});

describe("formatMoney", () => {
  it("shows cents under $100 and whole dollars above", () => {
    expect(formatMoney(4.5)).toBe("$4.50");
    expect(formatMoney(1234.4)).toBe("$1,234");
  });
});
