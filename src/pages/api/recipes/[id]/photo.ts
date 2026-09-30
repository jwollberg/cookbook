import type { APIRoute } from "astro";
import { loadRecipe, saveRecipe } from "../../../../lib/server/db";
import { BadRequest, fail, handle, json } from "../../../../lib/server/http";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
/** The editor downsizes before uploading, so anything near this is a mistake. */
const MAX_BYTES = 8 * 1024 * 1024;
const PREFIX = "/photos/";

/**
 * Replace a recipe's photo with an uploaded one; the body is the image
 * itself. Each upload gets a fresh key, so a photo URL can be cached forever
 * and a replacement still shows up immediately.
 */
export const POST: APIRoute = ({ params, request, locals }) =>
  handle(async () => {
    const env = locals.runtime.env;
    const recipe = await loadRecipe(env.DB, params.id!);
    if (!recipe) return fail(404, "Save the recipe before adding a photo.");

    const type = (request.headers.get("Content-Type") ?? "").split(";")[0].trim();
    const ext = TYPES[type];
    if (!ext) throw new BadRequest("Photos must be JPEG, PNG or WebP.");
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) throw new BadRequest("That photo is empty.");
    if (body.byteLength > MAX_BYTES) throw new BadRequest("That photo is too large (8 MB at most).");

    const key = `recipes/${recipe.id}/${Date.now().toString(36)}.${ext}`;
    await env.PHOTOS.put(key, body, { httpMetadata: { contentType: type } });

    // A photo of your own needs no credit line; a starter photo's goes with it.
    const saved = await saveRecipe(
      env.DB,
      { ...recipe, image: `${PREFIX}${key}`, imageCredit: undefined },
      [],
      locals.viewer.id,
    );
    if (recipe.image?.startsWith(PREFIX)) await env.PHOTOS.delete(recipe.image.slice(PREFIX.length));
    return json({ recipe: saved });
  });

export const DELETE: APIRoute = ({ params, locals }) =>
  handle(async () => {
    const env = locals.runtime.env;
    const recipe = await loadRecipe(env.DB, params.id!);
    if (!recipe) return fail(404, "No such recipe.");
    const saved = await saveRecipe(
      env.DB,
      { ...recipe, image: undefined, imageCredit: undefined },
      [],
      locals.viewer.id,
    );
    if (recipe.image?.startsWith(PREFIX)) await env.PHOTOS.delete(recipe.image.slice(PREFIX.length));
    return json({ recipe: saved });
  });
