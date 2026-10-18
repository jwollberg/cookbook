import { describe, it, expect } from "vitest";
import { emptyPlan, pickCurrentPlan, resolvePlan, sundayOf, toSundayWeeks } from "./plans";
import type { MealPlan } from "./schema";

const withDinner = (sunday: string): MealPlan => {
  const plan = emptyPlan(sunday);
  plan.days[2].entries.push({ slot: "dinner", recipeId: "falafel" });
  return plan;
};

describe("week plans", () => {
  it("keys a week by its Sunday", () => {
    expect(sundayOf("2026-10-01")).toBe("2026-09-27"); // a Thursday
    expect(sundayOf("2026-10-03")).toBe("2026-09-27"); // the Saturday closes the same week
    expect(sundayOf("2026-10-04")).toBe("2026-10-04"); // the Sunday opens the next
    expect(emptyPlan("2026-09-27").id).toBe("week-2026-09-27");
    expect(emptyPlan("2026-09-27").days.map((d) => d.date)).toEqual([
      "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03",
    ]);
  });

  it("follows the current week while it lasts", () => {
    const plans = [withDinner("2026-09-27"), withDinner("2026-10-04")];
    expect(pickCurrentPlan(plans, "2026-10-01")?.id).toBe("week-2026-09-27");
    expect(pickCurrentPlan(plans, "2026-10-03")?.id).toBe("week-2026-09-27");
  });

  it("moves on to next week once this one is over", () => {
    const plans = [withDinner("2026-09-27"), withDinner("2026-10-04")];
    expect(pickCurrentPlan(plans, "2026-10-04")?.id).toBe("week-2026-10-04");
  });

  it("skips an empty week and never falls back to an old one", () => {
    expect(pickCurrentPlan([emptyPlan("2026-09-27"), withDinner("2026-10-04")], "2026-09-30")?.id).toBe(
      "week-2026-10-04",
    );
    expect(pickCurrentPlan([withDinner("2026-09-20")], "2026-09-30")).toBeNull();
  });

  it("honours an explicit choice, including none", () => {
    const plans = [withDinner("2026-09-20"), withDinner("2026-09-27")];
    expect(resolvePlan(plans, "week-2026-09-20", "2026-09-30")?.id).toBe("week-2026-09-20");
    expect(resolvePlan(plans, null, "2026-09-30")).toBeNull();
    expect(resolvePlan(plans, undefined, "2026-09-30")?.id).toBe("week-2026-09-27");
  });

  it("follows a list pinned to an old Monday week to the Sunday week holding it", () => {
    const plans = [withDinner("2026-09-20"), withDinner("2026-09-27")];
    expect(resolvePlan(plans, "week-2026-09-21", "2026-09-30")?.id).toBe("week-2026-09-20");
  });
});

describe("regrouping Monday weeks into Sunday weeks", () => {
  const monday = (start: string, entries: Record<string, string>, updatedAt?: string, notes?: string): MealPlan => ({
    id: `week-${start}`,
    name: `Week of ${start}`,
    days: Object.entries(entries).map(([date, recipeId]) => ({ date, entries: [{ slot: "dinner", recipeId }] })),
    ...(notes ? { notes } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  });
  const dinners = (plans: MealPlan[]) =>
    Object.fromEntries(
      plans.map((p) => [p.id, Object.fromEntries(p.days.filter((d) => d.entries.length).map((d) => [d.date, d.entries[0].recipeId]))]),
    );

  it("leaves Sunday weeks alone", () => {
    const plans = [withDinner("2026-09-27"), emptyPlan("2026-10-04")];
    expect(toSundayWeeks(plans)).toEqual({ plans, changed: false });
  });

  it("puts each day of a Monday week in the Sunday week it falls in", () => {
    const { plans, changed } = toSundayWeeks([
      monday("2026-09-28", { "2026-09-28": "falafel", "2026-10-03": "pizza", "2026-10-04": "potato-soup" }, "2026-09-28T10:00:00Z", "Grill out"),
    ]);
    expect(changed).toBe(true);
    expect(dinners(plans)).toEqual({
      "week-2026-09-27": { "2026-09-28": "falafel", "2026-10-03": "pizza" },
      "week-2026-10-04": { "2026-10-04": "potato-soup" },
    });
    for (const p of plans) expect(p.days).toHaveLength(7);
    expect(plans.find((p) => p.id === "week-2026-09-27")?.notes).toBe("Grill out");
  });

  it("lets whichever plan was saved last win a day two plans both hold", () => {
    const sunday = { ...withDinner("2026-09-27"), updatedAt: "2026-09-29T10:00:00Z" }; // falafel on the 29th
    const older = monday("2026-09-28", { "2026-09-29": "pizza", "2026-09-30": "tacos" }, "2026-09-28T10:00:00Z");
    expect(dinners(toSundayWeeks([sunday, older]).plans)).toEqual({
      "week-2026-09-27": { "2026-09-29": "falafel" }, // its empty 30th was saved last too
    });
    const newer = { ...older, updatedAt: "2026-09-30T10:00:00Z" };
    expect(dinners(toSundayWeeks([sunday, newer]).plans)).toEqual({
      "week-2026-09-27": { "2026-09-29": "pizza", "2026-09-30": "tacos" },
    });
  });

  it("drops a week left with nothing planned", () => {
    expect(toSundayWeeks([monday("2026-09-28", {})]).plans).toEqual([]);
  });
});
