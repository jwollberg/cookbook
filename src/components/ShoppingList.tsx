import { useEffect, useMemo, useState } from "react";
import { buildShoppingList, expandPlan } from "../lib/shopping";
import { formatRange } from "../lib/dates";
import { getDraftPlan, loadCookbook, type Cookbook } from "../lib/store";
import type { MealPlan } from "../lib/schema";

const TICKED_KEY = "cookbook:ticked";

/** Ticks are per-item and survive a reload — a shop takes more than one page view. */
function readTicked(): Record<string, boolean> {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(TICKED_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export default function ShoppingList() {
  const [cookbook, setCookbook] = useState<Cookbook | null>(null);
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [includeStaples, setIncludeStaples] = useState(false);

  useEffect(() => {
    setTicked(readTicked());
    void (async () => {
      const { data } = await loadCookbook();
      setCookbook(data);

      // ?plan= wins so a saved plan can be linked to; otherwise the working draft.
      const wanted = new URLSearchParams(window.location.search).get("plan");
      const chosen = wanted ? data.plans.find((p) => p.id === wanted) : null;
      setPlan(chosen ?? getDraftPlan() ?? data.plans[0] ?? null);
    })();
  }, []);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(TICKED_KEY, JSON.stringify(ticked));
    }
  }, [ticked]);

  const list = useMemo(() => {
    if (!cookbook || !plan) return null;
    const dishes = expandPlan(
      plan,
      new Map(cookbook.recipes.map((r) => [r.id, r])),
      new Map(cookbook.meals.map((m) => [m.id, m])),
    );
    if (dishes.length === 0) return null;
    return buildShoppingList(dishes, new Map(cookbook.ingredients.map((i) => [i.id, i])), {
      pantry: cookbook.pantry,
      includeStaples,
    });
  }, [cookbook, plan, includeStaples]);

  if (!cookbook) return <p style={{ color: "var(--muted)" }}>Loading…</p>;

  if (!plan || !list) {
    return (
      <div className="card" style={{ padding: "22px 24px" }}>
        <p style={{ margin: 0, color: "var(--ink-2)" }}>
          Nothing to shop for yet — the list is generated from a plan.
        </p>
        <a className="btn btn-primary" href="/plan" style={{ marginTop: 16 }}>
          Build a plan
        </a>
      </div>
    );
  }

  const dates = plan.days.map((d) => d.date);
  const total = list.groups.reduce((n, g) => n + g.lines.length, 0);
  const done = list.groups
    .flatMap((g) => g.lines)
    .filter((l) => ticked[l.ingredientId]).length;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 18,
        }}
      >
        <div>
          <strong style={{ fontFamily: "var(--display)", fontSize: "1.2rem" }}>{plan.name}</strong>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            {" "}· {formatRange(dates[0], dates[dates.length - 1])}
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="chip num">
            {done}/{total} ticked
          </span>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={includeStaples}
              onChange={(e) => setIncludeStaples(e.target.checked)}
            />
            Include staples
          </label>
          {done > 0 && (
            <button className="btn btn-sm" onClick={() => setTicked({})}>
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="grid-cards">
        {list.groups.map((group) => (
          <section key={group.aisle} className="card" style={{ padding: "14px 18px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="aisle-dot" style={{ ["--aisle" as string]: `var(--aisle-${group.aisle})` }} />
              <span className="lbl" style={{ textTransform: "capitalize" }}>{group.aisle}</span>
            </div>

            <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
              {group.lines.map((line) => {
                const on = Boolean(ticked[line.ingredientId]);
                return (
                  <li key={line.ingredientId} className={on ? "shop-row done" : "shop-row"}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) =>
                        setTicked((t) => ({ ...t, [line.ingredientId]: e.target.checked }))
                      }
                      aria-label={line.name}
                    />
                    <span className="ing-qty">{line.parts.map((p) => p.text).join(" + ")}</span>
                    <span className="shop-name">
                      {line.name}
                      {/* Provenance: useful when you are staring at a quantity
                          wondering which dish wanted it. */}
                      <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
                        {line.fromRecipes.join(", ")}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {list.splitLines.length > 0 && (
        <p style={{ marginTop: 16, fontSize: 13, color: "var(--muted)" }}>
          {list.splitLines.length} ingredient
          {list.splitLines.length === 1 ? " is" : "s are"} shown in more than one unit — no
          conversion factor exists for them, so they are listed separately rather than guessed.
        </p>
      )}

      {!includeStaples && (
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--muted)" }}>
          Staples like salt and pepper are hidden. Tick “Include staples” if you need to restock.
        </p>
      )}
    </div>
  );
}
