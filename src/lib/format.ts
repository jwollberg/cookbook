/**
 * Display helpers shared by pages and islands. PURE — safe on both sides.
 */

import type { Meal, Recipe } from "./schema";

/** What a recipe card needs — all that crosses to the browser for a grid. */
export interface RecipeCard {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  image?: string;
  tags: string[];
  servings: number;
  timeLabel: string | null;
}

export function recipeCard(recipe: Recipe): RecipeCard {
  return {
    id: recipe.id,
    title: recipe.title,
    subtitle: recipe.subtitle,
    description: recipe.description,
    image: recipe.image,
    tags: recipe.tags,
    servings: recipe.servings,
    timeLabel: formatMinutes(activeMinutes(recipe)),
  };
}

/**
 * A meal's photos, main course first — the meal's cover is a collage of its
 * dishes, so a meal is never left with a blank card.
 */
export function mealImages(meal: Meal, recipesById: Map<string, Recipe>): string[] {
  const order = ["main", "side", "starter", "sauce", "dessert", "drink"];
  return [...meal.components]
    .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role))
    .map((c) => recipesById.get(c.recipeId)?.image)
    .filter((src): src is string => Boolean(src));
}

/**
 * How long a meal takes: the longest component, not the sum. The dishes
 * overlap in the oven and on the counter, so summing them would badly
 * overstate the evening.
 */
export function mealMinutes(meal: Meal, recipesById: Map<string, Recipe>): number {
  return Math.max(
    0,
    ...meal.components.map((c) => {
      const r = recipesById.get(c.recipeId);
      return r ? r.prepMin + r.cookMin : 0;
    }),
  );
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
