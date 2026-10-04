/**
 * Kitchen's tile on home.atheosstudios.com: what's for dinner tonight, how
 * much of the week is planned, and how long the list is. Home asks for it
 * over an RPC service binding (`Glance` in src/worker.ts); the shape must
 * match `KitchenGlance` in Website-Home/src/lib/glance.ts.
 */

import { MealPlanSchema } from "../schema";
import { entryCount, mondayOf, planIdFor } from "../plans";
import { countList, ensureHousehold, userForEmail } from "./db";

export interface KitchenGlance {
  household: string;
  /** what's planned for today, dish names */
  tonight: string[];
  /** days this week with something planned */
  plannedDays: number;
  /** extra items and dishes on the shopping list */
  listCount: number;
}

export async function kitchenGlance(env: Env, email: string, today: string): Promise<KitchenGlance> {
  const db = env.DB;
  const viewer = await userForEmail(db, email);
  const household = await ensureHousehold(db, viewer);

  const [planRow, listCount] = await Promise.all([
    db
      .prepare("SELECT data FROM plans WHERE household_id = ? AND id = ?")
      .bind(household.id, planIdFor(mondayOf(today)))
      .first<{ data: string }>(),
    countList(db, household.id),
  ]);

  let plannedDays = 0;
  let tonight: string[] = [];
  const parsed = planRow ? MealPlanSchema.safeParse(JSON.parse(planRow.data)) : null;
  if (parsed?.success) {
    const plan = parsed.data;
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

  return { household: household.name, tonight, plannedDays, listCount };
}
