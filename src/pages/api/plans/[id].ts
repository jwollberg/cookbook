import type { APIRoute } from "astro";
import { z } from "zod";
import { MealPlanSchema } from "../../../lib/schema";
import { getHousehold, savePlan } from "../../../lib/server/db";
import { BadRequest, fail, handle, json, readBody } from "../../../lib/server/http";

const Body = z.object({
  /**
   * Named by the page rather than read from the session: after switching
   * household in another tab, this tab's edits must still land in the
   * household it is showing.
   */
  householdId: z.string().min(1),
  plan: MealPlanSchema,
});

export const PUT: APIRoute = ({ params, request, locals }) =>
  handle(async () => {
    const { householdId, plan } = await readBody(request, Body);
    if (plan.id !== params.id || !/^week-\d{4}-\d{2}-\d{2}$/.test(plan.id)) {
      throw new BadRequest("That is not a week plan id.");
    }
    const db = locals.runtime.env.DB;
    if (!(await getHousehold(db, householdId))) return fail(404, "That household no longer exists.");
    const saved = await savePlan(db, householdId, plan, locals.viewer.id);
    return json({ plan: saved });
  });
