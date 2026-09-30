/**
 * What most pages load: the shared library plus the current household's
 * planning, fetched together. At this scale (dozens of recipes) loading the
 * whole library per request is a few milliseconds and keeps pages simple.
 */

import { todayIn } from "../dates";
import { loadLibrary, loadPlanning } from "./db";

export async function loadKitchen(locals: App.Locals) {
  const db = locals.runtime.env.DB;
  const [library, planning] = await Promise.all([loadLibrary(db), loadPlanning(db, locals.household.id)]);
  return {
    library,
    planning,
    household: locals.household,
    viewer: locals.viewer,
    recipesById: new Map(library.recipes.map((r) => [r.id, r])),
    mealsById: new Map(library.meals.map((m) => [m.id, m])),
    ingredientsById: new Map(library.ingredients.map((i) => [i.id, i])),
  };
}

/** The visitor's time zone, as Cloudflare reports it. */
function timeZone(locals: App.Locals): string | undefined {
  const tz = (locals.runtime?.cf as { timezone?: string } | undefined)?.timezone;
  return typeof tz === "string" && tz ? tz : undefined;
}

/** Today's date where the visitor is. */
export function viewerToday(locals: App.Locals): string {
  return todayIn(timeZone(locals));
}

export function greeting(locals: App.Locals): string {
  let hour = new Date().getHours();
  try {
    hour = Number(
      new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: timeZone(locals) }).format(
        new Date(),
      ),
    );
  } catch {
    /* unknown zone: server hour will do */
  }
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
