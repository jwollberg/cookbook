/**
 * Week plans: one per household per week, keyed `week-<monday>`.
 */

import { formatDayLabel, fromIso, isoDate, startOfWeek, weekDates } from "./dates";
import type { MealPlan } from "./schema";

export const planIdFor = (monday: string) => `week-${monday}`;

export function emptyPlan(monday: string): MealPlan {
  return {
    id: planIdFor(monday),
    name: `Week of ${formatDayLabel(monday)}`,
    days: weekDates(fromIso(monday)).map((date) => ({ date, entries: [] })),
  };
}

export function mondayOf(iso: string): string {
  return isoDate(startOfWeek(fromIso(iso)));
}

export function entryCount(plan: MealPlan): number {
  return plan.days.reduce((n, d) => n + d.entries.length, 0);
}

const firstDate = (plan: MealPlan) => plan.days[0]?.date ?? "";
const lastDate = (plan: MealPlan) => plan.days[plan.days.length - 1]?.date ?? "";

/**
 * The plan to follow when nobody has picked one: the earliest week that has
 * not finished yet and has something on it. Once this week is over, next
 * week's plan is the one worth shopping and cooking from.
 */
export function pickCurrentPlan(plans: MealPlan[], today: string): MealPlan | null {
  return (
    plans
      .filter((p) => entryCount(p) > 0 && lastDate(p) >= today)
      .sort((a, b) => firstDate(a).localeCompare(firstDate(b)))[0] ?? null
  );
}

/** `undefined` means automatic, `null` means no plan, a string names one. */
export function resolvePlan(
  plans: MealPlan[],
  choice: string | null | undefined,
  today: string,
): MealPlan | null {
  if (choice === null) return null;
  if (choice) return plans.find((p) => p.id === choice) ?? null;
  return pickCurrentPlan(plans, today);
}
