import type { APIRoute } from "astro";
import { z } from "zod";
import { applyListEdit } from "../../lib/list";
import { ListEditSchema } from "../../lib/schema";
import { clearTicks, loadShoppingState, mutateShopping, setTick } from "../../lib/server/db";
import { handle, json, notFound, readBody } from "../../lib/server/http";

const Body = z.object({
  /** Whose list the page is showing, named by the page — see api/plans/[id].ts. */
  owner: z.string().min(1),
  edit: ListEditSchema,
});

/** The list as it stands — polled when the page regains focus, so two phones in one shop agree. */
export const GET: APIRoute = ({ url, locals }) =>
  handle(async () => {
    if (url.searchParams.get("owner") !== locals.viewer.id) return notFound();
    return json(await loadShoppingState(locals.runtime.env.DB, locals.viewer.id));
  });

/** Apply one edit to the viewer's own list and return the list as it now stands. */
export const POST: APIRoute = ({ request, locals }) =>
  handle(async () => {
    const { owner, edit } = await readBody(request, Body);
    if (owner !== locals.viewer.id) return notFound();
    const db = locals.runtime.env.DB;
    const userId = locals.viewer.id;

    switch (edit.type) {
      case "tick":
        await setTick(db, userId, edit.key, edit.on);
        break;
      case "clearTicks":
        await clearTicks(db, userId);
        break;
      case "clear":
        await mutateShopping(db, userId, (current) => applyListEdit(current, edit));
        await clearTicks(db, userId);
        break;
      default:
        await mutateShopping(db, userId, (current) => applyListEdit(current, edit));
    }

    return json(await loadShoppingState(db, userId));
  });
