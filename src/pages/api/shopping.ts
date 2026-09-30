import type { APIRoute } from "astro";
import { z } from "zod";
import { applyListEdit } from "../../lib/list";
import { ListEditSchema } from "../../lib/schema";
import {
  clearTicks,
  getHousehold,
  loadShoppingState,
  mutateShopping,
  setTick,
} from "../../lib/server/db";
import { fail, handle, json, readBody } from "../../lib/server/http";

const Body = z.object({
  /** Named by the page, not the session — see api/plans/[id].ts. */
  householdId: z.string().min(1),
  edit: ListEditSchema,
});

/** The list as it stands — polled when the page regains focus, so two phones in one shop agree. */
export const GET: APIRoute = ({ url, locals }) =>
  handle(async () => {
    const householdId = url.searchParams.get("householdId") ?? "";
    const db = locals.runtime.env.DB;
    if (!(await getHousehold(db, householdId))) return fail(404, "That household no longer exists.");
    return json(await loadShoppingState(db, householdId));
  });

/** Apply one edit to a household's list and return the list as it now stands. */
export const POST: APIRoute = ({ request, locals }) =>
  handle(async () => {
    const { householdId, edit } = await readBody(request, Body);
    const db = locals.runtime.env.DB;
    if (!(await getHousehold(db, householdId))) return fail(404, "That household no longer exists.");
    const userId = locals.viewer.id;

    switch (edit.type) {
      case "tick":
        await setTick(db, householdId, edit.key, edit.on);
        break;
      case "clearTicks":
        await clearTicks(db, householdId);
        break;
      case "clear":
        await mutateShopping(db, householdId, userId, (current) => applyListEdit(current, edit));
        await clearTicks(db, householdId);
        break;
      default:
        await mutateShopping(db, householdId, userId, (current) => applyListEdit(current, edit));
    }

    return json(await loadShoppingState(db, householdId));
  });
