import type { APIRoute } from "astro";
import { z } from "zod";
import { MealPlanSchema } from "../../../lib/schema";
import { savePlan } from "../../../lib/server/db";
import { BadRequest, handle, json, notFound, readBody } from "../../../lib/server/http";

const Body = z.object({
  /**
   * Whose kitchen the page is showing (their users.id), named by the page
   * rather than read from the session: a tab left open from before switching
   * Google account must not save its week over the new account's.
   */
  owner: z.string().min(1),
  plan: MealPlanSchema,
});

export const PUT: APIRoute = ({ params, request, locals }) =>
  handle(async () => {
    const { owner, plan } = await readBody(request, Body);
    if (plan.id !== params.id || !/^week-\d{4}-\d{2}-\d{2}$/.test(plan.id)) {
      throw new BadRequest("That is not a week plan id.");
    }
    if (owner !== locals.viewer.id) return notFound();
    const saved = await savePlan(locals.runtime.env.DB, locals.viewer.id, plan);
    return json({ plan: saved });
  });
