/**
 * Price estimates: what a shopping list costs at the register, and what a
 * recipe costs to cook.
 *
 * Two different numbers, on purpose. A list line is bought in whole packages
 * (⅔ of a jar of sauce still means buying a jar), so it rounds UP to packages.
 * A recipe uses part of what was bought, so it costs only the share it uses —
 * otherwise a pinch of cumin would cost a whole bottle.
 *
 * The same safety rule as the list: an amount that can't be converted to the
 * price's package without guessing is left unpriced, never estimated anyway.
 */

import { bucketKey, toBase, toGrams } from "./units";
import { scaleIngredients } from "./scaling";
import type { Ingredient, Price, Recipe } from "./schema";
import type { ShoppingLine, ShoppingList } from "./shopping";

/** Rounding slack, so 2.0000001 packages is two packages rather than three. */
const EPSILON = 1e-6;

/**
 * How many of the price's packages an amount fills, as a fraction: 1.5 is a
 * package and a half. Null when the amount can't be converted to the
 * package's unit without a factor the ingredient doesn't have.
 */
export function packagesOf(
  baseAmount: number,
  bucket: string,
  price: Price,
  ingredient: Pick<Ingredient, "gramsPerMl" | "countWeights">,
): number | null {
  const packageBucket = bucketKey(price.unit);
  const packageBase = toBase(price.quantity, price.unit);
  if (bucket === packageBucket) return baseAmount / packageBase;

  const factors = { gramsPerMl: ingredient.gramsPerMl, countWeights: ingredient.countWeights };
  const grams = toGrams(baseAmount, bucket, factors);
  const packageGrams = toGrams(packageBase, packageBucket, factors);
  return grams === null || packageGrams === null || packageGrams <= 0 ? null : grams / packageGrams;
}

export interface LinePrice {
  /** Whole packages to buy. */
  packages: number;
  /** What those packages cost. */
  cost: number;
  price: Price;
}

/** What a shopping line costs to buy, in whole packages. Null when it can't be priced. */
export function priceLine(line: ShoppingLine, ingredient: Ingredient | undefined): LinePrice | null {
  const price = ingredient?.price;
  if (!price || line.covered) return null;
  // Added by hand with no amount: the request is "buy some", so one package.
  if (line.parts.length === 0) return { packages: 1, cost: price.amount, price };

  let fraction = 0;
  for (const part of line.parts) {
    const share = packagesOf(part.baseAmount, part.bucket, price, ingredient);
    if (share === null) return null;
    fraction += share;
  }
  const packages = Math.max(1, Math.ceil(fraction - EPSILON));
  return { packages, cost: packages * price.amount, price };
}

export interface ListCost {
  /** Every priced line on the list. */
  total: number;
  /** The priced lines not yet ticked off. */
  left: number;
  /** Lines to buy that have no price, or none that converts. */
  unpriced: number;
  byLine: Map<string, LinePrice>;
}

export function priceList(
  list: ShoppingList,
  ingredientsById: Map<string, Ingredient>,
  ticked: Set<string> = new Set(),
): ListCost {
  const byLine = new Map<string, LinePrice>();
  let total = 0;
  let left = 0;
  let unpriced = 0;
  for (const group of list.groups) {
    for (const line of group.lines) {
      if (line.covered) continue;
      const priced = priceLine(line, line.ingredientId ? ingredientsById.get(line.ingredientId) : undefined);
      if (!priced) {
        unpriced++;
        continue;
      }
      byLine.set(line.key, priced);
      total += priced.cost;
      if (!ticked.has(line.key)) left += priced.cost;
    }
  }
  return { total, left, unpriced, byLine };
}

export interface RecipeCost {
  /** The share of each priced package the recipe uses, at these servings. */
  total: number;
  perServing: number;
  servings: number;
  /** Ingredient lines (not optional) with no usable price. */
  unpriced: string[];
}

/** What a recipe's ingredients cost at the share it uses. Optional lines are left out, as on the list. */
export function recipeCost(
  recipe: Pick<Recipe, "servings" | "ingredients">,
  ingredientsById: Map<string, Ingredient>,
  servings = recipe.servings,
): RecipeCost {
  let total = 0;
  const unpriced: string[] = [];
  for (const line of scaleIngredients(recipe, servings)) {
    if (line.optional || line.quantity <= 0) continue;
    const ingredient = ingredientsById.get(line.ingredientId);
    const share = ingredient?.price
      ? packagesOf(toBase(line.quantity, line.unit), bucketKey(line.unit), ingredient.price, ingredient)
      : null;
    if (share === null || !ingredient?.price) {
      unpriced.push(line.ingredientId);
      continue;
    }
    total += share * ingredient.price.amount;
  }
  return { total, perServing: servings > 0 ? total / servings : total, servings, unpriced };
}

/** "$4.97"; whole dollars from $100 up, where cents are noise in an estimate. */
export function formatMoney(dollars: number): string {
  return dollars >= 100
    ? `$${Math.round(dollars).toLocaleString("en-US")}`
    : `$${dollars.toFixed(2)}`;
}
