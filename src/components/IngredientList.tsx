import { useMemo, useState } from "react";
import { formatUnitQuantity, UNITS } from "../lib/units";
import { scaleIngredient, scaleFactor } from "../lib/scaling";
import type { RecipeIngredient } from "../lib/schema";

export interface IngredientName {
  name: string;
  plural?: string;
}

interface Props {
  ingredients: RecipeIngredient[];
  baseServings: number;
  /** id -> display names. Passed in because the island cannot read the repo. */
  names: Record<string, IngredientName>;
  yieldNote?: string;
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

export default function IngredientList({ ingredients, baseServings, names, yieldNote }: Props) {
  const [servings, setServings] = useState(baseServings);

  const factor = scaleFactor({ servings: baseServings }, servings);
  const scaled = useMemo(
    () => ingredients.map((line) => scaleIngredient(line, factor)),
    [ingredients, factor],
  );

  // Preserve authoring order of groups; ungrouped lines come first.
  const groups = useMemo(() => {
    const map = new Map<string, RecipeIngredient[]>();
    for (const line of scaled) {
      const key = line.group ?? "";
      const list = map.get(key) ?? [];
      list.push(line);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [scaled]);

  const changed = servings !== baseServings;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <span className="lbl">Ingredients</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            className="btn btn-sm"
            onClick={() => setServings((s) => Math.max(1, s - 1))}
            disabled={servings <= 1}
            aria-label="Fewer servings"
          >
            −
          </button>
          <span
            className="num"
            aria-live="polite"
            style={{ minWidth: 92, textAlign: "center", fontWeight: 600, fontSize: 14 }}
          >
            {servings} {servings === 1 ? "serving" : "servings"}
          </span>
          <button
            className="btn btn-sm"
            onClick={() => setServings((s) => Math.min(99, s + 1))}
            disabled={servings >= 99}
            aria-label="More servings"
          >
            +
          </button>
        </div>
      </div>

      {changed && (
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>
          Scaled from {baseServings}.{" "}
          <button
            className="btn btn-ghost btn-sm"
            style={{ padding: "2px 6px", minHeight: 0, textDecoration: "underline" }}
            onClick={() => setServings(baseServings)}
          >
            Reset
          </button>
        </p>
      )}

      {!changed && yieldNote && (
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>Makes {yieldNote}.</p>
      )}

      {groups.map(([group, lines]) => (
        <div key={group} style={{ marginBottom: group ? 18 : 0 }}>
          {group && (
            <h3 style={{ fontSize: "0.95rem", margin: "14px 0 4px", color: "var(--ink-2)" }}>
              {group}
            </h3>
          )}
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {lines.map((line, i) => (
              <li className="ing-row" key={`${line.ingredientId}-${i}`}>
                <span className="ing-qty">
                  {formatUnitQuantity(line.quantity, line.unit)}
                  {/* A held quantity would otherwise look like a scaling bug. */}
                  {line.noScale && factor !== 1 && (
                    <span
                      title="Not scaled — this amount stays fixed"
                      style={{ color: "var(--muted)", fontWeight: 400 }}
                    >
                      {" "}
                      ∗
                    </span>
                  )}
                </span>
                <span className="ing-name">
                  {displayName(names[line.ingredientId], line.ingredientId, line.unit, line.quantity)}
                  {line.note && <span style={{ color: "var(--muted)" }}>, {line.note}</span>}
                  {line.optional && <span className="chip" style={{ marginLeft: 8 }}>optional</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {scaled.some((l) => l.noScale) && factor !== 1 && (
        <p style={{ marginTop: 12, fontSize: 12, color: "var(--muted)" }}>
          ∗ Held fixed — this amount does not scale with servings.
        </p>
      )}
    </div>
  );
}
