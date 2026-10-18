import type { APIRoute } from "astro";
import { z } from "zod";
import { ClaudeError } from "../../../lib/server/claude";
import { loadLibrary } from "../../../lib/server/db";
import { fail, handle, json, readBody } from "../../../lib/server/http";
import { BadLink, claudeApp, draftFromLink } from "../../../lib/server/recipe-draft";

/**
 * A recipe draft from a web page (POST { url } → { recipe, created }). Nothing is saved: the
 * editor shows the draft and the person saves it. Claude's use counts against the viewer.
 */
export const POST: APIRoute = ({ request, locals }) =>
  handle(async () => {
    const env = locals.runtime.env;
    const { url } = await readBody(request, z.object({ url: z.string().min(1).max(2000) }));
    const library = await loadLibrary(env.DB);
    try {
      return json(await draftFromLink(claudeApp(env), locals.viewer.id, url, library.ingredients));
    } catch (error) {
      if (error instanceof BadLink) return fail(400, error.message);
      if (error instanceof ClaudeError) return fail(422, error.message);
      throw error;
    }
  });
