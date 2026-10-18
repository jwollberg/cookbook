/**
 * Week plans: one per person per week, keyed `week-<sunday>`. Weeks run
 * Sunday to Saturday (until 2026-10 they ran Monday to Sunday, keyed by the
 * Monday; `toSundayWeeks` regroups any of those still stored).
 */

import { formatDayLabel, fromIso, isoDate, startOfWeek, weekDates } from "./dates";
import type { MealPlan, PlanEntry } from "./schema";

export const planIdFor = (sunday: string) => `week-${sunday}`;

export function emptyPlan(sunday: string): MealPlan {
  return {
    id: planIdFor(sunday),
    name: `Week of ${formatDayLabel(sunday)}`,
    days: weekDates(fromIso(sunday)).map((date) => ({ date, entries: [] })),
  };
}

/** The Sunday that starts the week `iso` falls in. */
export function sundayOf(iso: string): string {
  return isoDate(startOfWeek(fromIso(iso)));
}

/** A plan in today's shape: keyed by its Sunday, every day in that Sunday to Saturday. */
function isSundayWeek(plan: MealPlan): boolean {
  const start = plan.id.slice("week-".length);
  return sundayOf(start) === start && plan.days.every((d) => sundayOf(d.date) === start);
}

/**
 * Regroup plans into Sunday-to-Saturday weeks. Plans saved as Monday weeks
 * (before 2026-10, or by a tab still open from then) are split by date: each
 * day lands in the Sunday week it belongs to. Where two plans hold the same
 * date, the one saved last wins that day. A week left with nothing planned is
 * dropped. `changed` is false when every plan was already a Sunday week.
 */
export function toSundayWeeks(plans: MealPlan[]): { plans: MealPlan[]; changed: boolean } {
  if (plans.every(isSundayWeek)) return { plans, changed: false };
  const days = new Map<string, { entries: PlanEntry[]; from: MealPlan }>();
  const byAge = [...plans].sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""));
  for (const plan of byAge) for (const d of plan.days) days.set(d.date, { entries: d.entries, from: plan });
  const weeks = new Map<string, MealPlan>();
  const sources = new Map<string, MealPlan[]>();
  for (const [date, { entries, from }] of days) {
    if (entries.length === 0) continue;
    const sunday = sundayOf(date);
    const week = weeks.get(sunday) ?? emptyPlan(sunday);
    weeks.set(sunday, week);
    week.days = week.days.map((d) => (d.date === date ? { ...d, entries } : d));
    sources.set(sunday, [...(sources.get(sunday) ?? []), from]);
  }
  for (const [sunday, week] of weeks) {
    const from = sources.get(sunday)!;
    // Notes and the saved time come from the plan that gave the week most of its days.
    const daysFrom = (p: MealPlan) => from.filter((f) => f === p).length;
    const main = [...new Set(from)].sort((a, b) => daysFrom(b) - daysFrom(a))[0];
    if (main.notes) week.notes = main.notes;
    const newest = from.map((p) => p.updatedAt ?? "").sort().at(-1);
    if (newest) week.updatedAt = newest;
  }
  return { plans: [...weeks.values()], changed: true };
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
  if (choice) {
    // A list pinned to a Monday week follows the Sunday week holding its Monday to Saturday.
    const start = choice.slice("week-".length);
    const id = /^week-\d{4}-\d{2}-\d{2}$/.test(choice) ? planIdFor(sundayOf(start)) : choice;
    return plans.find((p) => p.id === id) ?? null;
  }
  return pickCurrentPlan(plans, today);
}
