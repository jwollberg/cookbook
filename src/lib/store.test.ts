/**
 * Reconcile rules for the local-first write path.
 *
 * These decide whether your unsaved edit or the published build wins. Get it
 * wrong in one direction and a save appears to vanish for a minute; wrong in
 * the other and a stale local copy shadows every later edit made from another
 * device, permanently. Neither failure is visible in the UI, hence the tests.
 */

import { describe, it, expect } from "vitest";
import { mergeStash, slugify, uniqueSlug, type Cookbook, type Stash } from "./store";
import type { Ingredient, Recipe } from "./schema";

const recipe = (id: string, updatedAt?: string, title = id): Recipe => ({
  id,
  title,
  servings: 4,
  prepMin: 0,
  cookMin: 0,
  restMin: 0,
  tags: [],
  ingredients: [],
  steps: [],
  updatedAt,
});

const cookbook = (recipes: Recipe[], ingredients: Ingredient[] = []): Cookbook => ({
  recipes,
  ingredients,
  meals: [],
  pantry: [],
});

const emptyStash = (): Stash => ({ recipes: {}, meals: {} });

const T1 = "2026-08-12T10:00:00.000Z";
const T2 = "2026-08-12T11:00:00.000Z";

describe("mergeStash", () => {
  it("shows a local edit that the build has not caught up with", () => {
    const published = cookbook([recipe("soup", T1, "Old title")]);
    const stash: Stash = { ...emptyStash(), recipes: { soup: recipe("soup", T2, "New title") } };

    const { data, pending, keep } = mergeStash(published, stash);
    expect(data.recipes[0].title).toBe("New title");
    expect(pending).toBe(1);
    expect(keep.recipes.soup).toBeDefined();
  });

  it("drops the stash once the build has caught up", () => {
    // Equal timestamps mean the commit landed and rebuilt. Keeping the local
    // copy here would shadow every future edit from another device.
    const published = cookbook([recipe("soup", T2, "Published")]);
    const stash: Stash = { ...emptyStash(), recipes: { soup: recipe("soup", T2, "Local") } };

    const { data, pending, keep } = mergeStash(published, stash);
    expect(data.recipes[0].title).toBe("Published");
    expect(pending).toBe(0);
    expect(keep.recipes).toEqual({});
  });

  it("drops the stash when the build is newer still", () => {
    const published = cookbook([recipe("soup", T2, "Published")]);
    const stash: Stash = { ...emptyStash(), recipes: { soup: recipe("soup", T1, "Stale local") } };

    const { data, pending } = mergeStash(published, stash);
    expect(data.recipes[0].title).toBe("Published");
    expect(pending).toBe(0);
  });

  it("surfaces a brand new recipe that is not published at all", () => {
    const { data, pending } = mergeStash(cookbook([]), {
      ...emptyStash(),
      recipes: { soup: recipe("soup", T1, "Brand new") },
    });
    expect(data.recipes).toHaveLength(1);
    expect(pending).toBe(1);
  });

  it("ignores a stashed recipe with no timestamp", () => {
    // Without a timestamp there is no way to tell whether it has landed, and
    // assuming it has not would pin it forever.
    const published = cookbook([recipe("soup", T1, "Published")]);
    const { data, pending } = mergeStash(published, {
      ...emptyStash(),
      recipes: { soup: recipe("soup", undefined, "Local") },
    });
    expect(data.recipes[0].title).toBe("Published");
    expect(pending).toBe(0);
  });

  it("keeps only ingredients the build does not have yet", () => {
    const published = cookbook(
      [],
      [{ id: "salt", name: "salt", aisle: "spices", aliases: [], isStaple: true }],
    );
    const stash: Stash = {
      ...emptyStash(),
      ingredientsAt: T2,
      ingredients: [
        { id: "salt", name: "salt", aisle: "spices", aliases: [], isStaple: true },
        { id: "saffron", name: "saffron", aisle: "spices", aliases: [], isStaple: false },
      ],
    };

    const { data, pending } = mergeStash(published, stash);
    expect(data.ingredients.map((i) => i.id).sort()).toEqual(["saffron", "salt"]);
    expect(pending).toBe(1);
  });

  it("drops the ingredient stash once every one of them is published", () => {
    const both: Ingredient[] = [
      { id: "salt", name: "salt", aisle: "spices", aliases: [], isStaple: true },
      { id: "saffron", name: "saffron", aisle: "spices", aliases: [], isStaple: false },
    ];
    const { data, pending, keep } = mergeStash(cookbook([], both), {
      ...emptyStash(),
      ingredientsAt: T1,
      ingredients: both,
    });
    expect(data.ingredients).toHaveLength(2);
    expect(pending).toBe(0);
    expect(keep.ingredients).toBeUndefined();
  });

  it("leaves published data untouched when nothing is stashed", () => {
    const published = cookbook([recipe("a", T1, "A"), recipe("b", T1, "B")]);
    const { data, pending } = mergeStash(published, emptyStash());
    expect(data.recipes).toHaveLength(2);
    expect(pending).toBe(0);
  });
});

describe("slugs", () => {
  it("makes schema-valid kebab-case ids", () => {
    expect(slugify("Greek Lemon Potatoes")).toBe("greek-lemon-potatoes");
    expect(slugify("  Mum's  Best!! Stew  ")).toBe("mum-s-best-stew");
    expect(slugify("Crème Brûlée")).toBe("creme-brulee");
  });

  it("avoids collisions", () => {
    expect(uniqueSlug("Soup", ["soup"])).toBe("soup-2");
    expect(uniqueSlug("Soup", ["soup", "soup-2"])).toBe("soup-3");
    expect(uniqueSlug("Soup", [])).toBe("soup");
  });

  it("never produces an empty id", () => {
    expect(uniqueSlug("!!!", [])).toBe("untitled");
  });
});
