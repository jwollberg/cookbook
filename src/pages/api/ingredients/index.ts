import type { APIRoute } from "astro";
import { z } from "zod";
import { IngredientSchema } from "../../../lib/schema";
import { createIngredient } from "../../../lib/server/db";
import { handle, json, readBody } from "../../../lib/server/http";

const Body = z.object({ ingredient: IngredientSchema });

/** Save a new item to the shared library, from the shopping list's picker. */
export const POST: APIRoute = ({ request, locals }) =>
  handle(async () => {
    const { ingredient } = await readBody(request, Body);
    const saved = await createIngredient(locals.runtime.env.DB, ingredient, locals.viewer.id);
    return json({ ingredient: saved }, 201);
  });
