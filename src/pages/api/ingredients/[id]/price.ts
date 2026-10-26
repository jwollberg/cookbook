import type { APIRoute } from "astro";
import { z } from "zod";
import { PriceSchema } from "../../../../lib/schema";
import { saveIngredientPrice } from "../../../../lib/server/db";
import { fail, handle, json, readBody } from "../../../../lib/server/http";

const Body = z.object({ price: PriceSchema.nullable() });

/** Set an ingredient's price, or clear it with null. */
export const PUT: APIRoute = ({ params, request, locals }) =>
  handle(async () => {
    const { price } = await readBody(request, Body);
    const saved = await saveIngredientPrice(locals.runtime.env.DB, params.id!, price, locals.viewer.id);
    if (!saved) return fail(404, "No such ingredient.");
    return json({ ingredient: saved });
  });
