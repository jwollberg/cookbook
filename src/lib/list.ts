/**
 * The shopping list's own contents: recipes, meals and loose items put on it
 * directly, with or without a plan.
 *
 * PURE. The server applies these to the household's list inside
 * mutateShopping (src/lib/server/db.ts); the browser uses the same functions
 * for its optimistic update, so both sides always agree on what an edit does.
 */

import { fromBase, resolveUnit, toBase, UNITS, dimensionOf, formatUnitQuantity } from "./units";
import type { Ingredient, ListDish, ListEdit, ListItem, ShoppingExtras } from "./schema";

/** Dispatched on window when the list changes, so the nav badge can follow. */
export const LIST_EVENT = "kitchen:list-changed";

export const emptyExtras = (): ShoppingExtras => ({ dishes: [], items: [] });

export function countExtras(extras: ShoppingExtras): number {
  return extras.dishes.length + extras.items.length;
}

// ---------------------------------------------------------------------------
// Dishes
// ---------------------------------------------------------------------------

export type DishRef = Pick<ListDish, "recipeId" | "mealId">;

const sameDish = (a: DishRef, b: DishRef) =>
  (Boolean(a.recipeId) && a.recipeId === b.recipeId) ||
  (Boolean(a.mealId) && a.mealId === b.mealId);

export function findDish(extras: ShoppingExtras, ref: DishRef): ListDish | undefined {
  return extras.dishes.find((d) => sameDish(d, ref));
}

/**
 * Put a recipe or meal on the list. Adding one that is already there sets
 * its servings rather than listing it twice — pressing the button again on a
 * recipe page scaled to 8 should mean 8, not 4 + 8.
 */
export function addDish(extras: ShoppingExtras, dish: ListDish): ShoppingExtras {
  if (!findDish(extras, dish)) return { ...extras, dishes: [...extras.dishes, dish] };
  return {
    ...extras,
    dishes: extras.dishes.map((d) => (sameDish(d, dish) ? { ...d, servings: dish.servings } : d)),
  };
}

export function removeDish(extras: ShoppingExtras, ref: DishRef): ShoppingExtras {
  return { ...extras, dishes: extras.dishes.filter((d) => !sameDish(d, ref)) };
}

export function setDishServings(
  extras: ShoppingExtras,
  ref: DishRef,
  servings: number | undefined,
): ShoppingExtras {
  return {
    ...extras,
    dishes: extras.dishes.map((d) => (sameDish(d, ref) ? { ...d, servings } : d)),
  };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type NewItem = Omit<ListItem, "id">;

export function newItemId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const identity = (item: NewItem) =>
  item.ingredientId ? `ing:${item.ingredientId}` : `txt:${normalise(item.name ?? "")}`;

/**
 * Add a hand-typed item, merging with one already on the list.
 *
 * Typing the same thing twice should not list it twice: the same ingredient
 * (or the same free text) in a compatible unit sums, and a bare repeat of
 * something already listed changes nothing. Incompatible units stay as
 * separate items — the same no-guessing rule the aggregator follows.
 */
export function addItem(extras: ShoppingExtras, item: NewItem, id = newItemId()): ShoppingExtras {
  const key = identity(item);
  const index = extras.items.findIndex((existing) => identity(existing) === key);
  if (index === -1) return { ...extras, items: [...extras.items, { ...item, id }] };

  const existing = extras.items[index];
  const merged = mergeAmounts(existing, item);
  if (merged === "separate") return { ...extras, items: [...extras.items, { ...item, id }] };

  return { ...extras, items: extras.items.map((x, i) => (i === index ? merged : x)) };
}

function mergeAmounts(existing: ListItem, incoming: NewItem): ListItem | "separate" {
  if (!incoming.quantity || !incoming.unit) return existing;
  if (!existing.quantity || !existing.unit) {
    return { ...existing, quantity: incoming.quantity, unit: incoming.unit };
  }
  if (existing.unit === incoming.unit) {
    return { ...existing, quantity: existing.quantity + incoming.quantity };
  }
  // Same dimension converts exactly (8 oz onto 1 lb is 1½ lb). Count units
  // are all different things, so "2 cans" onto "3" is not summable.
  const dim = dimensionOf(existing.unit);
  if (dim && dim !== "count" && dim === dimensionOf(incoming.unit)) {
    const base = toBase(existing.quantity, existing.unit) + toBase(incoming.quantity, incoming.unit);
    return { ...existing, quantity: fromBase(base, existing.unit) };
  }
  return "separate";
}

export function removeItem(extras: ShoppingExtras, id: string): ShoppingExtras {
  return { ...extras, items: extras.items.filter((i) => i.id !== id) };
}

/** "2 lb ground beef", "large eggs", "paper towels" — for the list's own chips. */
export function describeItem(item: ListItem, ingredientsById: Map<string, Ingredient>): string {
  const ingredient = item.ingredientId ? ingredientsById.get(item.ingredientId) : undefined;
  const bareCount = item.unit ? UNITS[item.unit]?.label === "" : true;
  const many = (item.quantity ?? 0) > 1;
  const name = ingredient
    ? bareCount && (many || !item.quantity) && ingredient.plural
      ? ingredient.plural
      : ingredient.name
    : (item.name ?? item.ingredientId ?? "");
  if (!item.quantity || !item.unit) return name;
  return `${formatUnitQuantity(item.quantity, item.unit)} ${name}`;
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

/**
 * Apply an edit to the list document. Ticks are not part of the document
 * (they live in their own table), so those edits leave it unchanged here.
 * `itemId` is injectable so tests, and the browser's optimistic copy, can
 * predict the id a new item gets.
 */
export function applyListEdit(extras: ShoppingExtras, edit: ListEdit, itemId = newItemId()): ShoppingExtras {
  switch (edit.type) {
    case "addDish":
      return addDish(extras, edit.dish);
    case "removeDish":
      return removeDish(extras, edit.ref);
    case "setServings":
      return setDishServings(extras, edit.ref, edit.servings ?? undefined);
    case "addItem":
      return addItem(extras, edit.item, itemId);
    case "removeItem":
      return removeItem(extras, edit.id);
    case "setPlan": {
      const { planId: _drop, ...rest } = extras;
      return edit.planId === "auto" ? rest : { ...rest, planId: edit.planId };
    }
    case "clear":
      return { ...extras, dishes: [], items: [] };
    case "tick":
    case "clearTicks":
      return extras;
  }
}

// ---------------------------------------------------------------------------
// Parsing typed items
// ---------------------------------------------------------------------------

export interface ParsedItem {
  ingredientId?: string;
  name?: string;
  quantity?: number;
  unit?: string;
}

const GLYPHS: Record<string, number> = {
  "½": 1 / 2,
  "¼": 1 / 4,
  "¾": 3 / 4,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 1 / 8,
};

/** A leading quantity: "2", "1.5", "1/2", "1 1/2", "1½", "½". */
function matchQuantity(text: string): { value: number; rest: string } | null {
  let m = text.match(/^(\d+)\s+(\d+)\/(\d+)(?:\s+|$)(.*)$/);
  if (m) return { value: Number(m[1]) + Number(m[2]) / Number(m[3]), rest: m[4] };

  m = text.match(/^(\d+)\/(\d+)(?:\s+|$)(.*)$/);
  if (m) return { value: Number(m[1]) / Number(m[2]), rest: m[3] };

  m = text.match(/^(\d+(?:[.,]\d+)?)([½¼¾⅓⅔⅛])?\s*(.*)$/);
  if (m) {
    const whole = Number(m[1].replace(",", "."));
    return { value: whole + (m[2] ? GLYPHS[m[2]] : 0), rest: m[3] };
  }

  m = text.match(/^([½¼¾⅓⅔⅛])\s*(.*)$/);
  if (m) return { value: GLYPHS[m[1]], rest: m[2] };

  return null;
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The phrase plus every plausible singular of its last word. */
function variants(phrase: string): string[] {
  const words = phrase.split(" ");
  const last = words.pop() ?? "";
  const head = words.length ? `${words.join(" ")} ` : "";
  const out = new Set([phrase]);
  if (last.endsWith("ies") && last.length > 4) out.add(`${head}${last.slice(0, -3)}y`);
  if (last.endsWith("es")) out.add(`${head}${last.slice(0, -2)}`);
  if (last.endsWith("s") && !last.endsWith("ss")) out.add(`${head}${last.slice(0, -1)}`);
  return [...out];
}

function keysFor(ingredient: Ingredient): string[] {
  return [ingredient.name, ingredient.plural, ingredient.id.replace(/-/g, " "), ...ingredient.aliases]
    .filter((k): k is string => Boolean(k))
    .map(normalise)
    .filter(Boolean);
}

/**
 * Find the registry ingredient a phrase means, or nothing.
 *
 * An exact name, plural or alias wins. Failing that, a name that merely
 * starts with extra words ("bell pepper" for "large bell pepper") counts,
 * fewest extra words first. Ambiguity returns nothing: "oil" could be olive
 * or neutral, and a wrong merge is worse than an unmerged free-text line.
 */
export function matchIngredient(text: string, ingredients: Ingredient[]): Ingredient | undefined {
  const wanted = variants(normalise(text)).filter(Boolean);
  if (wanted.length === 0) return undefined;

  let best: Ingredient[] = [];
  let bestScore = Infinity;
  for (const ingredient of ingredients) {
    let score = Infinity;
    for (const key of keysFor(ingredient)) {
      for (const k of variants(key)) {
        for (const w of wanted) {
          if (k === w) score = 0;
          else if (k.endsWith(` ${w}`)) {
            score = Math.min(score, k.slice(0, -w.length).trim().split(" ").length);
          }
        }
      }
    }
    if (score < bestScore) {
      bestScore = score;
      best = [ingredient];
    } else if (score === bestScore && score !== Infinity) {
      best.push(ingredient);
    }
  }
  return best.length === 1 ? best[0] : undefined;
}

/**
 * Turn what someone typed into a list item.
 *
 * "2 lb ground beef" -> 2 lb of the ground-beef ingredient, so it merges
 * with recipe quantities. "paper towels" -> free text. A bare number with no
 * unit counts in the ingredient's own count unit when it has one (cloves of
 * garlic, cans of chickpeas), otherwise as plain "each".
 */
export function parseItem(text: string, ingredients: Ingredient[]): ParsedItem | null {
  const raw = text.trim().replace(/\s+/g, " ");
  if (!raw) return null;

  let rest = raw;
  let quantity: number | undefined;
  let unit: string | undefined;

  const q = matchQuantity(rest);
  if (q && q.value > 0 && q.rest) {
    quantity = q.value;
    rest = q.rest;
    const words = rest.split(" ");
    // Two words first so "fl oz" beats "fl". Always leave a name behind:
    // "2 cans" alone is a thing called cans, not an empty can of nothing.
    for (const n of [2, 1]) {
      if (words.length <= n) continue;
      const candidate = words.slice(0, n).join(" ");
      const id = resolveUnit(candidate);
      if (id) {
        unit = id;
        rest = words.slice(n).join(" ");
        break;
      }
    }
    rest = rest.replace(/^of\s+/i, "");
  }

  const ingredient = matchIngredient(rest, ingredients);
  if (quantity !== undefined && !unit) {
    const own = ingredient?.defaultUnit;
    unit = own && dimensionOf(own) === "count" ? own : "each";
  }

  return ingredient
    ? { ingredientId: ingredient.id, quantity, unit }
    : { name: rest, quantity, unit };
}
