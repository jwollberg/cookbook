/**
 * Data model. Every record is a JSON document in D1 (see migrations/), and
 * the starter library is seeded from seed/*.json. Documents are validated on
 * every read and write, so a malformed one fails loudly instead of silently
 * producing a wrong shopping list.
 */

import { z } from "zod";
import { UNIT_IDS } from "./units";
import { AISLES, ROLES, SLOTS } from "./constants";

export { AISLES, ROLES, SLOTS };
export type { Aisle, Role, Slot } from "./constants";

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
  /**
   * /images/recipes/* for the starter photos (static, openly licensed), or
   * /photos/* for one uploaded in the editor (R2, behind sign-in).
   */
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

// ---------------------------------------------------------------------------
// Shopping list extras
// ---------------------------------------------------------------------------

/**
 * A recipe or meal put straight on the shopping list, without planning it
 * onto a day. A plan entry minus the slot.
 */
export const DishRefSchema = z
  .object({ mealId: slug.optional(), recipeId: slug.optional() })
  .refine((d) => Boolean(d.mealId) !== Boolean(d.recipeId), {
    message: "a list dish must reference exactly one of mealId or recipeId",
  });

export const ListDishSchema = z
  .object({
    mealId: slug.optional(),
    recipeId: slug.optional(),
    servings: z.number().positive().max(999).optional(),
  })
  .refine((d) => Boolean(d.mealId) !== Boolean(d.recipeId), {
    message: "a list dish must reference exactly one of mealId or recipeId",
  });
export type ListDish = z.infer<typeof ListDishSchema>;

/**
 * One thing to buy, added by hand.
 *
 * Linked to the ingredient registry whenever the text matches an ingredient,
 * so "2 lb ground beef" merges with the pound a recipe already asked for
 * instead of sitting beside it. Anything the registry doesn't know
 * ("paper towels") is kept as free text and never aggregated.
 */
const ListItemFields = z.object({
  id: z.string().min(1).max(64),
  ingredientId: slug.optional(),
  name: z.string().min(1).max(120).optional(),
  quantity: z.number().positive().max(100000).optional(),
  unit: unitId.optional(),
});
const namesSomething = (i: { ingredientId?: string; name?: string }) =>
  Boolean(i.ingredientId) || Boolean(i.name);

export const ListItemSchema = ListItemFields.refine(namesSomething, {
  message: "a list item needs an ingredientId or a name",
});
export type ListItem = z.infer<typeof ListItemSchema>;

/** An item as typed, before the list gives it an id. */
export const NewListItemSchema = ListItemFields.omit({ id: true }).refine(namesSomething, {
  message: "a list item needs an ingredientId or a name",
});

/**
 * Everything on the shopping list that did not come from a plan.
 *
 * The list you shop from is the plan (optional) plus these, aggregated
 * together — so the list works with no plan at all, and a recipe added here
 * still merges with the same ingredient from a planned dinner.
 */
export const ShoppingExtrasSchema = z.object({
  dishes: z.array(ListDishSchema).default([]),
  items: z.array(ListItemSchema).default([]),
  /**
   * Which plan feeds the list: a plan id, null for none, or absent for
   * automatic — the current or next planned week (see pickCurrentPlan).
   */
  planId: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
});
export type ShoppingExtras = z.infer<typeof ShoppingExtrasSchema>;

/**
 * One edit to a household's list. The server applies it to the latest copy
 * (see mutateShopping) rather than accepting a whole replacement list, so two
 * people adding things at the same moment both keep what they added.
 */
export const ListEditSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("addDish"), dish: ListDishSchema }),
  z.object({ type: z.literal("removeDish"), ref: DishRefSchema }),
  z.object({
    type: z.literal("setServings"),
    ref: DishRefSchema,
    servings: z.number().positive().max(999).nullable(),
  }),
  z.object({ type: z.literal("addItem"), item: NewListItemSchema }),
  z.object({ type: z.literal("removeItem"), id: z.string().min(1) }),
  /** "auto" follows the current week; null means no plan. */
  z.object({ type: z.literal("setPlan"), planId: z.union([z.literal("auto"), z.string().min(1), z.null()]) }),
  z.object({ type: z.literal("tick"), key: z.string().min(1).max(200), on: z.boolean() }),
  z.object({ type: z.literal("clearTicks") }),
  /** Empty the list: dishes, items and ticks. The plan choice stays. */
  z.object({ type: z.literal("clear") }),
]);
export type ListEdit = z.infer<typeof ListEditSchema>;
