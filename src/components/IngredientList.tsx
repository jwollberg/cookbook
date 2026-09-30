import { useMemo, useState } from "react";
import Icon from "./Icon";
import { Toast, useList } from "./useList";
import { formatUnitQuantity, UNITS } from "../lib/units";
import { scaleIngredient, scaleFactor } from "../lib/scaling";
import type { RecipeIngredient, ShoppingExtras } from "../lib/schema";

export interface IngredientName {
  name: string;
  plural?: string;
}

interface Props {
  recipeId: string;
  recipeTitle: string;
  ingredients: RecipeIngredient[];
  baseServings: number;
  /** id -> display names. Passed in so the island does not need the registry. */
  names: Record<string, IngredientName>;
  yieldNote?: string;
  householdId: string;
  householdName: string;
  extras: ShoppingExtras;
}

/**
 * Pick singular or plural for the ingredient itself.
 *
 * Only a bare count pluralises the ingredient name — "4 large ripe tomatoes".
 * With a measured unit the unit carries the plural instead, so the name stays
 * singular: "2 cups flour", not "2 cups flours".
 */
function displayName(entry: IngredientName | undefined, id: string, unitId: string, qty: number) {
  if (!entry) return id;
  const isBareCount = UNITS[unitId]?.dimension === "count" && UNITS[unitId]?.label === "";
  // Only quantities ABOVE one pluralise: "½ yellow onion", not "½ yellow onions".
  if (isBareCount && qty > 1 && entry.plural) return entry.plural;
  return entry.name;
}

export default function IngredientList({
  recipeId,
  recipeTitle,
  ingredients,
  baseServings,
  names,
  yieldNote,
  householdId,
  householdName,
  extras,
}: Props) {
  const list = useList(householdId, extras);
  const onList = list.has({ recipeId });
  const [servings, setServings] = useState(onList?.servings ?? baseServings);

  const factor = scaleFactor({ servings: baseServings }, servings);
  const scaled = useMemo(() => ingredients.map((line) => scaleIngredient(line, factor)), [ingredients, factor]);

  // Preserve authoring order of groups; ungrouped lines come first.
  const groups = useMemo(() => {
    const map = new Map<string, RecipeIngredient[]>();
    for (const line of scaled) {
      const key = line.group ?? "";
      map.set(key, [...(map.get(key) ?? []), line]);
    }
    return [...map.entries()];
  }, [scaled]);

  const changed = servings !== baseServings;
  const listed = onList ? (onList.servings ?? baseServings) : null;
  const wanted = servings === baseServings ? undefined : servings;

  return (
    <div className="panel panel-pad">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: "1.25rem" }}>Ingredients</h2>
        <div className="stepper">
          <button onClick={() => setServings((s) => Math.max(1, s - 1))} disabled={servings <= 1} aria-label="Fewer servings">
            <Icon name="minus" />
          </button>
          <output aria-live="polite">
            {servings} {servings === 1 ? "serving" : "servings"}
          </output>
          <button onClick={() => setServings((s) => Math.min(99, s + 1))} disabled={servings >= 99} aria-label="More servings">
            <Icon name="plus" />
          </button>
        </div>
      </div>

      <p className="small muted" style={{ margin: "10px 0 4px", minHeight: 20 }}>
        {changed ? (
          <>
            Scaled from {baseServings}.{" "}
            <button
              className="btn btn-ghost btn-sm"
              style={{ minHeight: 0, padding: "0 4px", textDecoration: "underline" }}
              onClick={() => setServings(baseServings)}
            >
              Reset
            </button>
          </>
        ) : yieldNote ? (
          `Makes ${yieldNote}.`
        ) : null}
      </p>

      {groups.map(([group, lines]) => (
        <div key={group}>
          {group && <h3 className="ing-group">{group}</h3>}
          <ul className="ing-list">
            {lines.map((line, i) => (
              <li className="ing-row" key={`${line.ingredientId}-${i}`}>
                <span className="ing-qty">
                  {formatUnitQuantity(line.quantity, line.unit)}
                  {/* A held quantity would otherwise look like a scaling bug. */}
                  {line.noScale && factor !== 1 && (
                    <span title="Not scaled — this amount stays fixed" className="muted" style={{ fontWeight: 400 }}>
                      {" "}
                      ∗
                    </span>
                  )}
                </span>
                <span className="ing-name">
                  {displayName(names[line.ingredientId], line.ingredientId, line.unit, line.quantity)}
                  {line.note && <span className="ing-note">, {line.note}</span>}
                  {line.optional && (
                    <span className="chip" style={{ marginLeft: 8, minHeight: 22, fontSize: 12 }}>
                      optional
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {scaled.some((l) => l.noScale) && factor !== 1 && (
        <p className="small muted" style={{ marginTop: 10 }}>
          ∗ Held fixed — this amount does not scale with servings.
        </p>
      )}

      <div style={{ display: "grid", gap: 8, marginTop: 18 }}>
        {listed === null ? (
          <button
            className="btn btn-primary btn-block"
            disabled={list.busy}
            onClick={() => list.add({ recipeId, servings: wanted }, recipeTitle)}
          >
            <Icon name="bag" /> Add to shopping list
          </button>
        ) : listed !== servings ? (
          <button
            className="btn btn-primary btn-block"
            disabled={list.busy}
            onClick={() => list.add({ recipeId, servings: wanted }, recipeTitle)}
          >
            <Icon name="bag" /> Update the list to {servings} servings
          </button>
        ) : (
          <div className="actions" style={{ justifyContent: "space-between" }}>
            <a className="btn" href="/shopping" style={{ flex: 1 }}>
              <Icon name="check" /> On the list · {listed} servings
            </a>
            <button
              className="btn btn-ghost btn-sm"
              disabled={list.busy}
              onClick={() => list.remove({ recipeId }, recipeTitle)}
            >
              Remove
            </button>
          </div>
        )}
        <p className="small muted" style={{ textAlign: "center" }}>
          Goes on the {householdName} list — no plan needed.
        </p>
      </div>

      <Toast toast={list.toast} />
    </div>
  );
}
