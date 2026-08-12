/**
 * Data model. The repo is the database — every one of these lives as JSON
 * under public/data/ and is validated on load, so a hand-edited or
 * browser-written file that goes malformed fails loudly instead of silently
 * producing a wrong shopping list.
 */

import { z } from "zod";
import { UNIT_IDS } from "./units";

export const AISLES = [
  "produce",
  "meat",
  "seafood",
  "dairy",
  "bakery",
  "pantry",
  "spices",
  "frozen",
  "other",
] as const;
export type Aisle = (typeof AISLES)[number];

export const ROLES = ["main", "side", "starter", "dessert", "drink", "sauce"] as const;
export type Role = (typeof ROLES)[number];

export const SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type Slot = (typeof SLOTS)[number];

const slug = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase kebab-case slug");

const unitId = z.enum(UNIT_IDS as [string, ...string[]]);

// ---------------------------------------------------------------------------
// Ingredient
// ---------------------------------------------------------------------------

export const IngredientSchema = z.object({
  id: slug,
  name: z.string().min(1),
  plural: z.string().optional(),
  aisle: z.enum(AISLES).default("other"),
  /** Alternate names, so an editor can find "garbanzo" under "chickpeas". */
  aliases: z.array(z.string()).default([]),
  /** Something always in the cupboard — excluded from shopping by default. */
  isStaple: z.boolean().default(false),
  /** Density, g per ml. Enables volume <-> mass conversion for this item. */
  gramsPerMl: z.number().positive().optional(),
  /**
   * Grams for ONE of a given count unit, e.g. { each: 150, clove: 5 }.
   * Absent entries simply mean "don't convert" — never assume a weight.
   */
  countWeights: z.record(z.string(), z.number().positive()).optional(),
  /** Preferred unit when an editor adds this ingredient to a recipe. */
  defaultUnit: unitId.optional(),
  notes: z.string().optional(),
});
export type Ingredient = z.infer<typeof IngredientSchema>;

export const IngredientsFileSchema = z.array(IngredientSchema);

// ---------------------------------------------------------------------------
// Recipe
// ---------------------------------------------------------------------------

export const RecipeIngredientSchema = z.object({
  ingredientId: slug,
  quantity: z.number().nonnegative(),
  unit: unitId,
  /** Preparation note: "finely pressed", "peeled and cut into wedges". */
  note: z.string().optional(),
  /** Optional items are shown but never added to a shopping list. */
  optional: z.boolean().default(false),
  /** Sub-recipe grouping, e.g. "For the dressing". */
  group: z.string().optional(),
  /**
   * Held at the quantity written regardless of servings. For things like
   * "oil for frying" where doubling the batch does not double the oil.
   */
  noScale: z.boolean().default(false),
});
export type RecipeIngredient = z.infer<typeof RecipeIngredientSchema>;

export const RecipeStepSchema = z.object({
  text: z.string().min(1),
  /** Short bold lead-in shown before the step text, e.g. "Bind & Chill". */
  heading: z.string().optional(),
  group: z.string().optional(),
});
export type RecipeStep = z.infer<typeof RecipeStepSchema>;

/**
 * Attribution for a photo.
 *
 * Not decorative metadata — the CC BY and CC BY-SA images this site uses
 * REQUIRE visible credit as a condition of the licence. Anything carrying an
 * `image` must carry this too, and the recipe page must render it.
 */
export const ImageCreditSchema = z.object({
  author: z.string().min(1),
  license: z.string().min(1),
  licenseUrl: z.string().url().optional(),
  /** Link back to the source page, e.g. the Wikimedia Commons file. */
  sourceUrl: z.string().url().optional(),
  title: z.string().optional(),
});
export type ImageCredit = z.infer<typeof ImageCreditSchema>;

export const RecipeSchema = z.object({
  id: slug,
  title: z.string().min(1),
  /** Native-language or traditional name, e.g. "Patates Sto Fourno". */
  subtitle: z.string().optional(),
  description: z.string().optional(),
  servings: z.number().positive().default(4),
  /** Free text where a count is more useful than servings: "12-14 patties". */
  yieldNote: z.string().optional(),
  prepMin: z.number().nonnegative().default(0),
  cookMin: z.number().nonnegative().default(0),
  /** Inactive time (chilling, resting). Matters for planning, not for effort. */
  restMin: z.number().nonnegative().default(0),
  tags: z.array(z.string()).default([]),
  sourceUrl: z.string().url().optional(),
  /** Path under /images/recipes/, served statically. */
  image: z.string().optional(),
  imageCredit: ImageCreditSchema.optional(),
  ingredients: z.array(RecipeIngredientSchema),
  steps: z.array(RecipeStepSchema),
  notes: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type Recipe = z.infer<typeof RecipeSchema>;

// ---------------------------------------------------------------------------
// Meal
// ---------------------------------------------------------------------------

export const MealComponentSchema = z.object({
  recipeId: slug,
  role: z.enum(ROLES).default("side"),
  /** Cook this component at a different serving count to the rest. */
  servingsOverride: z.number().positive().optional(),
});
export type MealComponent = z.infer<typeof MealComponentSchema>;

/**
 * A meal-level ordering step.
 *
 * This exists because the useful cooking order for a multi-recipe meal is not
 * the concatenation of each recipe's steps — it interleaves them ("put the
 * chickpeas in the oven next to the potatoes", "chop the salad while the
 * falafel chills"). That knowledge belongs to the meal, not to any one
 * recipe, and there is nowhere else in the model to put it.
 */
export const TimelineStepSchema = z.object({
  text: z.string().min(1),
  heading: z.string().optional(),
  /** Links the step to the recipe it concerns, when it maps to just one. */
  recipeId: slug.optional(),
});
export type TimelineStep = z.infer<typeof TimelineStepSchema>;

export const MealSchema = z.object({
  id: slug,
  name: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  components: z.array(MealComponentSchema),
  /** The "game plan": how to get everything to the table at once. */
  timeline: z.array(TimelineStepSchema).default([]),
  notes: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type Meal = z.infer<typeof MealSchema>;

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export const PlanEntrySchema = z
  .object({
    slot: z.enum(SLOTS).default("dinner"),
    mealId: slug.optional(),
    recipeId: slug.optional(),
    /** Overrides the recipe/meal default. Drives scaling and the list. */
    servings: z.number().positive().optional(),
  })
  .refine((e) => Boolean(e.mealId) !== Boolean(e.recipeId), {
    message: "a plan entry must reference exactly one of mealId or recipeId",
  });
export type PlanEntry = z.infer<typeof PlanEntrySchema>;

export const PlanDaySchema = z.object({
  /** ISO date, YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z.array(PlanEntrySchema).default([]),
});
export type PlanDay = z.infer<typeof PlanDaySchema>;

export const MealPlanSchema = z.object({
  id: slug,
  name: z.string().min(1),
  days: z.array(PlanDaySchema).default([]),
  notes: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type MealPlan = z.infer<typeof MealPlanSchema>;

// ---------------------------------------------------------------------------
// Pantry
// ---------------------------------------------------------------------------

export const PantryItemSchema = z.object({
  ingredientId: slug,
  quantity: z.number().nonnegative(),
  unit: unitId,
});
export type PantryItem = z.infer<typeof PantryItemSchema>;

export const PantryFileSchema = z.array(PantryItemSchema);
