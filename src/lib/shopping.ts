/**
 * Shopping list generation.
 *
 * Pipeline order is load-bearing:
 *
 *   plan -> expand meals to recipes -> scale by servings -> flatten to lines
 *        -> convert to base units -> sum per ingredient -> subtract pantry
 *        -> group by aisle -> render back into human units
 *
 * Scaling before summing, and subtracting pantry before pretty-printing, are
 * both required for the numbers to come out right.
 */

import {
  bucketKey,
  formatQuantity,
  toBase,
  toGrams,
  type MeasurementSystem,
} from "./units";
import { scaleIngredients } from "./scaling";
import type { Aisle, Ingredient, Meal, MealPlan, PantryItem, Recipe } from "./schema";
import { AISLES } from "./schema";

export interface ResolvedDish {
  recipe: Recipe;
  servings?: number;
}

export interface ShoppingPart {
  bucket: string;
  baseAmount: number;
  text: string;
}

export interface ShoppingLine {
  ingredientId: string;
  name: string;
  aisle: Aisle;
  isStaple: boolean;
  /**
   * Usually one entry. More than one means the quantities could not be
   * merged without inventing a conversion — see `splitLines` below.
   */
  parts: ShoppingPart[];
  /** Titles of the recipes that contributed, for provenance in the UI. */
  fromRecipes: string[];
  /** Pantry covered the whole requirement, so nothing needs buying. */
  covered: boolean;
}

export interface AisleGroup {
  aisle: Aisle;
  lines: ShoppingLine[];
}

export interface ShoppingList {
  groups: AisleGroup[];
  /**
   * Ingredients that ended up with more than one part because a
   * cross-dimension factor was missing. Surfacing this is deliberate: it is a
   * prompt to add `gramsPerMl` or a `countWeights` entry to that ingredient.
   */
  splitLines: string[];
  totalLines: number;
}

// ---------------------------------------------------------------------------
// Plan expansion
// ---------------------------------------------------------------------------

/** Flatten a plan into the dishes actually being cooked, with servings. */
export function expandPlan(
  plan: MealPlan,
  recipesById: Map<string, Recipe>,
  mealsById: Map<string, Meal>,
): ResolvedDish[] {
  const dishes: ResolvedDish[] = [];

  for (const day of plan.days) {
    for (const entry of day.entries) {
      if (entry.recipeId) {
        const recipe = recipesById.get(entry.recipeId);
        if (recipe) dishes.push({ recipe, servings: entry.servings });
        continue;
      }
      if (!entry.mealId) continue;

      const meal = mealsById.get(entry.mealId);
      if (!meal) continue;

      for (const component of meal.components) {
        const recipe = recipesById.get(component.recipeId);
        if (!recipe) continue;
        // A component override wins over the plan entry's servings — it exists
        // precisely to cook one part of a meal at a different scale.
        dishes.push({ recipe, servings: component.servingsOverride ?? entry.servings });
      }
    }
  }

  return dishes;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

interface Accumulator {
  buckets: Map<string, number>;
  recipes: Set<string>;
}

/**
 * Build a shopping list from a set of dishes.
 *
 * `includeStaples` defaults to false: salt and pepper on every list is noise,
 * and the whole point of the staple flag is to keep them off it.
 */
export function buildShoppingList(
  dishes: ResolvedDish[],
  ingredientsById: Map<string, Ingredient>,
  options: {
    pantry?: PantryItem[];
    system?: MeasurementSystem;
    includeStaples?: boolean;
  } = {},
): ShoppingList {
  const { pantry = [], system = "us", includeStaples = false } = options;

  const acc = new Map<string, Accumulator>();

  for (const dish of dishes) {
    for (const line of scaleIngredients(dish.recipe, dish.servings)) {
      // Optional items are shown on the recipe but never bought automatically.
      if (line.optional) continue;
      if (line.quantity <= 0) continue;

      const entry = acc.get(line.ingredientId) ?? { buckets: new Map(), recipes: new Set() };
      const bucket = bucketKey(line.unit);
      entry.buckets.set(bucket, (entry.buckets.get(bucket) ?? 0) + toBase(line.quantity, line.unit));
      entry.recipes.add(dish.recipe.title);
      acc.set(line.ingredientId, entry);
    }
  }

  subtractPantry(acc, pantry);

  const lines: ShoppingLine[] = [];
  const splitLines: string[] = [];

  for (const [ingredientId, entry] of acc) {
    const ingredient = ingredientsById.get(ingredientId);
    const isStaple = ingredient?.isStaple ?? false;
    if (isStaple && !includeStaples) continue;

    const merged = mergeBuckets(entry.buckets, ingredient);
    const parts: ShoppingPart[] = [];

    for (const [bucket, baseAmount] of merged) {
      // Pantry subtraction can drive a bucket to zero or slightly negative.
      // Anything under a gram/ml is rounding dust, not a shopping item.
      if (baseAmount <= 0.0001) continue;
      parts.push({
        bucket,
        baseAmount,
        text: formatQuantity(baseAmount, bucket, system).text,
      });
    }

    const name = shoppingName(ingredient, ingredientId, parts);
    if (parts.length === 0) {
      lines.push({
        ingredientId,
        name,
        aisle: ingredient?.aisle ?? "other",
        isStaple,
        parts: [],
        fromRecipes: [...entry.recipes],
        covered: true,
      });
      continue;
    }

    if (parts.length > 1) splitLines.push(ingredientId);

    lines.push({
      ingredientId,
      name,
      aisle: ingredient?.aisle ?? "other",
      isStaple,
      parts,
      fromRecipes: [...entry.recipes],
      covered: false,
    });
  }

  return {
    groups: groupByAisle(lines),
    splitLines,
    totalLines: lines.length,
  };
}

/**
 * Singular or plural for the ingredient name on a list line.
 *
 * Only a bare count pluralises the ingredient itself — "4 large ripe
 * tomatoes". With a measured unit the unit carries the plural instead, so the
 * name stays singular: "2 cups flour", never "2 cups flours".
 */
function shoppingName(
  ingredient: Ingredient | undefined,
  fallbackId: string,
  parts: ShoppingPart[],
): string {
  if (!ingredient) return fallbackId;
  if (!ingredient.plural) return ingredient.name;
  const bareCount = parts.find((p) => p.bucket === "count:each");
  return bareCount && bareCount.baseAmount > 1 ? ingredient.plural : ingredient.name;
}

/**
 * Collapse an ingredient's buckets into as few as honestly possible.
 *
 * A single bucket is left alone — all-volume or all-mass needs no conversion,
 * and forcing volume to mass would lose the unit the cook actually wants.
 *
 * With several buckets, each is converted to grams where a factor exists.
 * Buckets that CANNOT convert are kept separate rather than guessed at. That
 * is the core safety rule: "500 g chicken + 2 breasts" is honest, whereas an
 * invented weight-per-breast quietly produces a wrong number.
 */
function mergeBuckets(
  buckets: Map<string, number>,
  ingredient: Ingredient | undefined,
): Map<string, number> {
  if (buckets.size <= 1) return buckets;

  const factors = ingredient
    ? { gramsPerMl: ingredient.gramsPerMl, countWeights: ingredient.countWeights }
    : undefined;

  const out = new Map<string, number>();
  let grams = 0;
  let gramsSeen = false;

  for (const [bucket, amount] of buckets) {
    const asGrams = toGrams(amount, bucket, factors);
    if (asGrams === null) {
      out.set(bucket, amount);
    } else {
      grams += asGrams;
      gramsSeen = true;
    }
  }

  if (gramsSeen) out.set("mass", (out.get("mass") ?? 0) + grams);
  return out;
}

/** Remove what's already on hand, in base units, bucket by bucket. */
function subtractPantry(acc: Map<string, Accumulator>, pantry: PantryItem[]): void {
  for (const item of pantry) {
    const entry = acc.get(item.ingredientId);
    if (!entry) continue;
    const bucket = bucketKey(item.unit);
    const have = toBase(item.quantity, item.unit);
    const need = entry.buckets.get(bucket);
    if (need === undefined) continue;
    entry.buckets.set(bucket, need - have);
  }
}

function groupByAisle(lines: ShoppingLine[]): AisleGroup[] {
  const byAisle = new Map<Aisle, ShoppingLine[]>();
  for (const line of lines) {
    const list = byAisle.get(line.aisle) ?? [];
    list.push(line);
    byAisle.set(line.aisle, list);
  }

  // AISLES order is the walking order of a supermarket, not alphabetical —
  // the list is only useful in a store if it follows the route.
  return AISLES.filter((aisle) => byAisle.has(aisle)).map((aisle) => ({
    aisle,
    lines: byAisle.get(aisle)!.sort((a, b) => a.name.localeCompare(b.name)),
  }));
}
