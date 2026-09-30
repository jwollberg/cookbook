/**
 * The cooking sheet: every dish in a plan, day by day, with quantities
 * already scaled. Rendered on the server only — there is nothing on it to
 * interact with, so it ships no JavaScript.
 */

import { formatDayLabel } from "../lib/dates";
import { formatUnitQuantity, UNITS } from "../lib/units";
import { scaleIngredients } from "../lib/scaling";
import type { Ingredient, Meal, MealPlan, Recipe } from "../lib/schema";

interface Dish {
  recipe: Recipe;
  servings?: number;
  role?: string;
}

export default function CookSheet({
  plan,
  recipesById,
  mealsById,
  ingredientsById,
}: {
  plan: MealPlan;
  recipesById: Map<string, Recipe>;
  mealsById: Map<string, Meal>;
  ingredientsById: Map<string, Ingredient>;
}) {
  const days = plan.days
    .filter((day) => day.entries.length > 0)
    .map((day) => ({
      date: day.date,
      slots: day.entries.map((entry) => {
        if (entry.mealId) {
          const meal = mealsById.get(entry.mealId);
          const dishes: Dish[] = (meal?.components ?? []).flatMap((c) => {
            const recipe = recipesById.get(c.recipeId);
            return recipe ? [{ recipe, servings: c.servingsOverride ?? entry.servings, role: c.role }] : [];
          });
          return { slot: entry.slot, meal, dishes };
        }
        const recipe = entry.recipeId ? recipesById.get(entry.recipeId) : undefined;
        return { slot: entry.slot, meal: undefined, dishes: recipe ? [{ recipe, servings: entry.servings }] : [] };
      }),
    }));

  return (
    <div style={{ display: "grid", gap: 48 }}>
      {days.map((day) => (
        <section key={day.date}>
          <h2 style={{ paddingBottom: 10, borderBottom: "2px solid var(--ink)" }}>{formatDayLabel(day.date)}</h2>

          {day.slots.map((slot, si) => (
            <div key={si} style={{ marginTop: 22, display: "grid", gap: 14 }}>
              <div className="actions" style={{ gap: 10 }}>
                <span className="chip chip-accent" style={{ textTransform: "capitalize" }}>
                  {slot.slot}
                </span>
                {slot.meal && <strong style={{ fontSize: "1.15rem" }}>{slot.meal.name}</strong>}
              </div>

              {/* The meal-level order comes first: it interleaves the recipes,
                  which is the whole reason it exists. */}
              {slot.meal && slot.meal.timeline.length > 0 && (
                <div className="callout" style={{ display: "grid", gap: 6 }}>
                  <span className="label">Order of work</span>
                  <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>
                    {slot.meal.timeline.map((step, i) => (
                      <li key={i}>
                        {step.heading && <strong>{step.heading}. </strong>}
                        {step.text}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {slot.dishes.map((dish) => (
                <DishBlock key={dish.recipe.id + (dish.role ?? "")} dish={dish} byId={ingredientsById} />
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
    <article className="panel panel-pad" style={{ breakInside: "avoid" }}>
      <div className="actions" style={{ justifyContent: "space-between" }}>
        <h3 style={{ fontSize: "1.2rem" }}>
          {dish.role && (
            <span className="label" style={{ marginRight: 8 }}>
              {dish.role}
            </span>
          )}
          <a href={`/recipes/${recipe.id}`} style={{ textDecoration: "none" }}>
            {recipe.title}
          </a>
        </h3>
        <span className="small muted">
          Serves {effective}
          {effective !== recipe.servings && ` (scaled from ${recipe.servings})`}
        </span>
      </div>

      <div className="recipe-body" style={{ marginTop: 14, gap: 28 }}>
        <div>
          <span className="label">Ingredients</span>
          <ul className="ing-list" style={{ marginTop: 6 }}>
            {scaled.map((line, i) => {
              const ing = byId.get(line.ingredientId);
              const bare = UNITS[line.unit]?.label === "";
              const name = bare && line.quantity > 1 && ing?.plural ? ing.plural : (ing?.name ?? line.ingredientId);
              return (
                <li key={i} className="ing-row" style={{ paddingBlock: 7 }}>
                  <span className="ing-qty">{formatUnitQuantity(line.quantity, line.unit)}</span>
                  <span className="ing-name">
                    {name}
                    {line.note && <span className="ing-note">, {line.note}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <span className="label">Method</span>
          <ol className="steps">
            {recipe.steps.map((step, i) => (
              <li key={i} className="step" style={{ paddingBlock: 12 }}>
                <span className="step-n">{i + 1}</span>
                <div className="step-body" style={{ fontSize: "1rem" }}>
                  {step.heading && <strong>{step.heading}</strong>}
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
