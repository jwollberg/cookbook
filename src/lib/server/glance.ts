/**
 * Kitchen's tile on home.atheosstudios.com, for one person: their kitchen's
 * name, what's for dinner tonight, how much of the week is planned, and how
 * long the list is. Home asks for it (POST /internal/glance); the shape must
 * match `KitchenGlance` in Website-Home.
 */

import { entryCount, sundayOf, planIdFor } from "../plans";
import { countList, kitchenName, loadPlan, usersForEmail } from "./db";

export interface KitchenGlance {
  /** "Josh's kitchen" */
  kitchen: string;
  /** what's planned for today, dish names */
  tonight: string[];
  /** days this week with something planned */
  plannedDays: number;
  /** extra items and dishes on the shopping list */
  listCount: number;
}

/**
 * Only the asker's own week and list. Someone who has never opened Kitchen
 * has no users row yet: an empty week, never someone else's — and asking
 * makes no row for them.
 */
export async function kitchenGlance(env: Env, email: string, today: string): Promise<KitchenGlance> {
  const db = env.DB;
  const [person] = await usersForEmail(db, email);
  const kitchen = kitchenName(person ?? { name: null, email: email.trim() });
  if (!person) return { kitchen, tonight: [], plannedDays: 0, listCount: 0 };

  const [plan, listCount] = await Promise.all([
    loadPlan(db, person.id, planIdFor(sundayOf(today))),
    countList(db, person.id),
  ]);

  let plannedDays = 0;
  let tonight: string[] = [];
  if (plan) {
    plannedDays = entryCount(plan) === 0 ? 0 : plan.days.filter((d) => d.entries.length > 0).length;
    const entries = plan.days.find((d) => d.date === today)?.entries ?? [];
    const recipeIds = entries.flatMap((e) => (e.recipeId && !e.mealId ? [e.recipeId] : []));
    const mealIds = entries.flatMap((e) => (e.mealId ? [e.mealId] : []));
    const names = new Map<string, string>();
    const marks = (ids: string[]) => ids.map(() => "?").join(",");
    if (recipeIds.length) {
      const { results } = await db
        .prepare(`SELECT id, json_extract(data, '$.title') AS name FROM recipes WHERE id IN (${marks(recipeIds)})`)
        .bind(...recipeIds)
        .all<{ id: string; name: string | null }>();
      for (const r of results) if (r.name) names.set(`r:${r.id}`, r.name);
    }
    if (mealIds.length) {
      const { results } = await db
        .prepare(`SELECT id, json_extract(data, '$.name') AS name FROM meals WHERE id IN (${marks(mealIds)})`)
        .bind(...mealIds)
        .all<{ id: string; name: string | null }>();
      for (const m of results) if (m.name) names.set(`m:${m.id}`, m.name);
    }
    tonight = entries
      .map((e) => (e.mealId ? names.get(`m:${e.mealId}`) : e.recipeId ? names.get(`r:${e.recipeId}`) : undefined))
      .filter((n): n is string => Boolean(n));
  }

  return { kitchen, tonight, plannedDays, listCount };
}
