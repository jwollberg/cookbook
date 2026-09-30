import type { APIRoute } from "astro";
import { z } from "zod";
import { IngredientSchema, RecipeSchema } from "../../../lib/schema";
import { deleteRecipe, loadRecipe, saveRecipe } from "../../../lib/server/db";
import { BadRequest, fail, handle, json, readBody } from "../../../lib/server/http";

const SaveBody = z.object({
  recipe: RecipeSchema,
  /** Ingredients created inline in the editor, saved in the same transaction. */
  newIngredients: z.array(IngredientSchema).default([]),
});

export const PUT: APIRoute = ({ params, request, locals }) =>
  handle(async () => {
    const { recipe, newIngredients } = await readBody(request, SaveBody);
    if (recipe.id !== params.id) throw new BadRequest("The recipe id does not match the URL.");
    const saved = await saveRecipe(locals.runtime.env.DB, recipe, newIngredients, locals.viewer.id);
    return json({ recipe: saved });
  });

export const DELETE: APIRoute = ({ params, locals }) =>
  handle(async () => {
    const env = locals.runtime.env;
    const existing = await loadRecipe(env.DB, params.id!);
    if (!existing) return fail(404, "No such recipe.");
    await deleteRecipe(env.DB, existing.id);
    if (existing.image?.startsWith("/photos/")) {
      await env.PHOTOS.delete(existing.image.slice("/photos/".length));
    }
    return json({ ok: true });
  });
