import { describe, it, expect } from "vitest";
import { emptyPlan, mondayOf, pickCurrentPlan, resolvePlan } from "./plans";
import type { MealPlan } from "./schema";

const withDinner = (monday: string): MealPlan => {
  const plan = emptyPlan(monday);
  plan.days[2].entries.push({ slot: "dinner", recipeId: "falafel" });
  return plan;
};

describe("week plans", () => {
  it("keys a week by its Monday", () => {
    expect(mondayOf("2026-10-01")).toBe("2026-09-28"); // a Thursday
    expect(mondayOf("2026-10-04")).toBe("2026-09-28"); // the Sunday closes the same week
    expect(emptyPlan("2026-09-28").id).toBe("week-2026-09-28");
    expect(emptyPlan("2026-09-28").days).toHaveLength(7);
  });

  it("follows the current week while it lasts", () => {
    const plans = [withDinner("2026-09-28"), withDinner("2026-10-05")];
    expect(pickCurrentPlan(plans, "2026-10-01")?.id).toBe("week-2026-09-28");
    expect(pickCurrentPlan(plans, "2026-10-04")?.id).toBe("week-2026-09-28");
  });

  it("moves on to next week once this one is over", () => {
    const plans = [withDinner("2026-09-28"), withDinner("2026-10-05")];
    expect(pickCurrentPlan(plans, "2026-10-05")?.id).toBe("week-2026-10-05");
  });

  it("skips an empty week and never falls back to an old one", () => {
    expect(pickCurrentPlan([emptyPlan("2026-09-28"), withDinner("2026-10-05")], "2026-09-30")?.id).toBe(
      "week-2026-10-05",
    );
    expect(pickCurrentPlan([withDinner("2026-09-21")], "2026-09-30")).toBeNull();
  });

  it("honours an explicit choice, including none", () => {
    const plans = [withDinner("2026-09-21"), withDinner("2026-09-28")];
    expect(resolvePlan(plans, "week-2026-09-21", "2026-09-30")?.id).toBe("week-2026-09-21");
    expect(resolvePlan(plans, null, "2026-09-30")).toBeNull();
    expect(resolvePlan(plans, undefined, "2026-09-30")?.id).toBe("week-2026-09-28");
  });
});
