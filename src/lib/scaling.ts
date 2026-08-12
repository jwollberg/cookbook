/**
 * Servings scaling.
 *
 * Kept separate from aggregation because order matters: scaling must happen
 * BEFORE quantities are summed. Summing first and scaling the total is only
 * equivalent when every recipe in the plan scales by the same factor, which
 * is exactly the case that stops holding as soon as a plan has two entries.
 */

import type { Recipe, RecipeIngredient } from "./schema";

export function scaleFactor(recipe: Pick<Recipe, "servings">, targetServings?: number): number {
  if (!targetServings || targetServings <= 0) return 1;
  if (!recipe.servings || recipe.servings <= 0) return 1;
  return targetServings / recipe.servings;
}

/**
 * Scale one ingredient line.
 *
 * `noScale` lines are returned untouched. That flag exists for things like
 * "3 tbsp oil for frying" — doubling the batch does not double the oil in the
 * pan, and silently doubling it would put a nonsense number on the list.
 */
export function scaleIngredient(line: RecipeIngredient, factor: number): RecipeIngredient {
  if (line.noScale || factor === 1) return line;
  return { ...line, quantity: line.quantity * factor };
}

export function scaleIngredients(
  recipe: Pick<Recipe, "servings" | "ingredients">,
  targetServings?: number,
): RecipeIngredient[] {
  const factor = scaleFactor(recipe, targetServings);
  return recipe.ingredients.map((line) => scaleIngredient(line, factor));
}

/**
 * Rewrite quantities that appear inline in step text.
 *
 * Deliberately NOT implemented. Steps here are written referring to
 * "the olive oil" rather than "1/2 cup olive oil", so there is nothing to
 * rewrite — and a regex that rewrote numbers inside prose would eventually
 * mangle "400°F" or "9x13-inch". The ingredient list is the single place
 * quantities live.
 */
