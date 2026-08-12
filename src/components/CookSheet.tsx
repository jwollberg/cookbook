import { useEffect, useMemo, useState } from "react";
import { formatDayLabel, formatRange } from "../lib/dates";
import { formatUnitQuantity, UNITS } from "../lib/units";
import { scaleIngredients } from "../lib/scaling";
import { getDraftPlan, loadCookbook, type Cookbook } from "../lib/store";
import type { Ingredient, Meal, MealPlan, Recipe } from "../lib/schema";

interface Dish {
  recipe: Recipe;
  servings?: number;
  role?: string;
}

interface DayBlock {
  date: string;
  slots: { slot: string; meal?: Meal; dishes: Dish[] }[];
}

export default function CookSheet() {
  const [cookbook, setCookbook] = useState<Cookbook | null>(null);
  const [plan, setPlan] = useState<MealPlan | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await loadCookbook();
      setCookbook(data);
      const wanted = new URLSearchParams(window.location.search).get("plan");
      const chosen = wanted ? data.plans.find((p) => p.id === wanted) : null;
      setPlan(chosen ?? getDraftPlan() ?? data.plans[0] ?? null);
    })();
  }, []);

  const days: DayBlock[] = useMemo(() => {
    if (!cookbook || !plan) return [];
    const recipesById = new Map(cookbook.recipes.map((r) => [r.id, r]));
    const mealsById = new Map(cookbook.meals.map((m) => [m.id, m]));

    return plan.days
      .filter((day) => day.entries.length > 0)
      .map((day) => ({
        date: day.date,
        slots: day.entries.map((entry) => {
          if (entry.mealId) {
            const meal = mealsById.get(entry.mealId);
            // flatMap rather than map+filter: a type predicate on an optional
            // field trips ts(2677), and dropping the empties inline is clearer.
            const dishes: Dish[] = (meal?.components ?? []).flatMap((c) => {
              const recipe = recipesById.get(c.recipeId);
              if (!recipe) return [];
              return [{ recipe, servings: c.servingsOverride ?? entry.servings, role: c.role }];
            });
            return { slot: entry.slot, meal, dishes };
          }
          const recipe = entry.recipeId ? recipesById.get(entry.recipeId) : undefined;
          return {
            slot: entry.slot,
            dishes: recipe ? [{ recipe, servings: entry.servings }] : [],
          };
        }),
      }));
  }, [cookbook, plan]);

  if (!cookbook) return <p style={{ color: "var(--muted)" }}>Loading…</p>;

  if (!plan || days.length === 0) {
    return (
      <div className="card" style={{ padding: "22px 24px" }}>
        <p style={{ margin: 0, color: "var(--ink-2)" }}>
          Nothing to cook yet — the sheet is generated from a plan.
        </p>
        <a className="btn btn-primary" href="/plan" style={{ marginTop: 16 }}>
          Build a plan
        </a>
      </div>
    );
  }

  const dates = plan.days.map((d) => d.date);
  const byId = new Map(cookbook.ingredients.map((i) => [i.id, i]));

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <strong style={{ fontFamily: "var(--display)", fontSize: "1.2rem" }}>{plan.name}</strong>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          {" "}· {formatRange(dates[0], dates[dates.length - 1])}
        </span>
      </div>

      {days.map((day) => (
        <section key={day.date} style={{ marginBottom: 52 }}>
          <h2
            style={{
              fontSize: "1.7rem",
              paddingBottom: 8,
              borderBottom: "2px solid var(--ink)",
            }}
          >
            {formatDayLabel(day.date)}
          </h2>

          {day.slots.map((slot, si) => (
            <div key={si} style={{ marginTop: 26 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span className="chip chip-accent" style={{ textTransform: "capitalize" }}>
                  {slot.slot}
                </span>
                {slot.meal && (
                  <strong style={{ fontFamily: "var(--display)", fontSize: "1.25rem" }}>
                    {slot.meal.name}
                  </strong>
                )}
              </div>

              {/* The meal-level order comes first: it interleaves the recipes,
                  which is the whole reason it exists. */}
              {slot.meal && slot.meal.timeline.length > 0 && (
                <div
                  className="card"
                  style={{
                    marginTop: 12,
                    padding: "14px 18px 16px",
                    background: "var(--olive-wash)",
                    borderColor: "transparent",
                  }}
                >
                  <span className="lbl" style={{ color: "var(--olive)" }}>Order of work</span>
                  <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                    {slot.meal.timeline.map((step, i) => (
                      <li key={i} style={{ marginTop: 4 }}>
                        {step.heading && <strong>{step.heading}. </strong>}
                        {step.text}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {slot.dishes.map((dish) => (
                <DishBlock key={dish.recipe.id + (dish.role ?? "")} dish={dish} byId={byId} />
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function DishBlock({ dish, byId }: { dish: Dish; byId: Map<string, Ingredient> }) {
  const { recipe, servings } = dish;
  const scaled = scaleIngredients(recipe, servings);
  const effective = servings ?? recipe.servings;

  return (
    <article style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--hairline)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: "1.15rem" }}>
          {dish.role && (
            <span className="lbl" style={{ marginRight: 8 }}>{dish.role}</span>
          )}
          {recipe.title}
        </h3>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          Serves {effective}
          {effective !== recipe.servings && ` (scaled from ${recipe.servings})`}
        </span>
      </div>

      <div className="recipe-layout" style={{ marginTop: 12, gap: 28 }}>
        <div>
          <span className="lbl">Ingredients</span>
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
            {scaled.map((line, i) => {
              const ing = byId.get(line.ingredientId);
              const bare = UNITS[line.unit]?.label === "";
              const name =
                bare && line.quantity > 1 && ing?.plural ? ing.plural : (ing?.name ?? line.ingredientId);
              return (
                <li key={i} className="ing-row" style={{ paddingBlock: 6 }}>
                  <span className="ing-qty">{formatUnitQuantity(line.quantity, line.unit)}</span>
                  <span className="ing-name">
                    {name}
                    {line.note && <span style={{ color: "var(--muted)" }}>, {line.note}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <span className="lbl">Method</span>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {recipe.steps.map((step, i) => (
              <li key={i} className="step" style={{ paddingBlock: 12 }}>
                <span className="step-n num">{i + 1}</span>
                <div className="step-body" style={{ fontSize: "1rem" }}>
                  {step.heading && (
                    <strong style={{ display: "block", color: "var(--ink)" }}>{step.heading}</strong>
                  )}
                  {step.text}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </article>
  );
}
