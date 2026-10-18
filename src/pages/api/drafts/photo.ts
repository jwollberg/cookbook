import type { APIRoute } from "astro";
import { ClaudeError } from "../../../lib/server/claude";
import { loadLibrary } from "../../../lib/server/db";
import { BadRequest, fail, handle, json } from "../../../lib/server/http";
import { BadLink, claudeApp, draftFromPhoto } from "../../../lib/server/recipe-draft";

/** The editor downsizes before sending, so anything near this is a mistake. */
const MAX_BYTES = 12 * 1024 * 1024;

/**
 * A recipe draft from a photo of a cookbook page or recipe card (the body is the image →
 * { recipe, created }). The photo is shrunk, read and dropped: it is never stored, and never
 * becomes the recipe's own photo. Nothing is saved until the person saves the draft.
 */
export const POST: APIRoute = ({ request, locals }) =>
  handle(async () => {
    const env = locals.runtime.env;
    const type = (request.headers.get("Content-Type") ?? "").split(";")[0].trim();
    if (!type.startsWith("image/")) throw new BadRequest("Send a photo (JPEG, PNG or WebP).");
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength === 0) throw new BadRequest("That photo is empty.");
    if (body.byteLength > MAX_BYTES) throw new BadRequest("That photo is too large (12 MB at most).");
    const library = await loadLibrary(env.DB);
    try {
      return json(await draftFromPhoto(claudeApp(env), locals.viewer.id, body, library.ingredients));
    } catch (error) {
      if (error instanceof BadLink) return fail(400, error.message);
      if (error instanceof ClaudeError) return fail(422, error.message);
      throw error;
    }
  });
