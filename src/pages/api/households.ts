import type { APIRoute } from "astro";
import { safeNext } from "../../lib/server/auth";
import {
  cleanHouseholdName,
  createHousehold,
  defaultHouseholdName,
  getHousehold,
  renameHousehold,
  setActiveHousehold,
} from "../../lib/server/db";

/**
 * Household actions, posted by plain HTML forms so the switcher works before
 * any JavaScript has loaded. Each one redirects back (303, so a refresh does
 * not resubmit).
 */
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const db = locals.runtime.env.DB;
  const viewer = locals.viewer;

  if (intent === "switch") {
    const id = String(form.get("id") ?? "");
    if (await getHousehold(db, id)) await setActiveHousehold(db, viewer.id, id);
    return redirect(safeNext(String(form.get("next") ?? "/")), 303);
  }

  if (intent === "create") {
    const name = cleanHouseholdName(String(form.get("name") ?? "")) || defaultHouseholdName(viewer);
    const household = await createHousehold(db, viewer.id, name);
    await setActiveHousehold(db, viewer.id, household.id);
    return redirect("/household?created=1", 303);
  }

  if (intent === "rename") {
    const id = String(form.get("id") ?? "");
    const name = cleanHouseholdName(String(form.get("name") ?? ""));
    if (name && (await getHousehold(db, id))) await renameHousehold(db, id, name);
    return redirect("/household?renamed=1", 303);
  }

  return new Response("Unknown household action.", { status: 400 });
};
