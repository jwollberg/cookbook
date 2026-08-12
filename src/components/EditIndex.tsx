import { useEffect, useState } from "react";
import { loadCookbook, type Cookbook } from "../lib/store";

/**
 * Client-rendered so a just-created recipe appears immediately.
 *
 * The published bundle lags a save by the length of a Pages rebuild, so a
 * build-time list would leave a new recipe invisible for a minute — exactly
 * when you want to click into it.
 */
export default function EditIndex() {
  const [data, setData] = useState<Cookbook | null>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    void (async () => {
      const result = await loadCookbook();
      setData(result.data);
      setPending(result.pending);
    })();
  }, []);

  if (!data) return <p style={{ color: "var(--muted)" }}>Loading…</p>;

  return (
    <div style={{ display: "grid", gap: 30 }}>
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span className="lbl">Recipes ({data.recipes.length})</span>
          <a className="btn btn-sm btn-primary" href="/edit/recipe">+ New recipe</a>
        </div>
        <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0 }}>
          {data.recipes.map((r) => (
            <li
              key={r.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                padding: "10px 0",
                borderBottom: "1px solid var(--hairline)",
              }}
            >
              <span>
                {r.title}
                <span style={{ color: "var(--muted)", fontSize: 13 }}>
                  {" "}· {r.ingredients.length} ingredients · serves {r.servings}
                </span>
              </span>
              <span style={{ display: "flex", gap: 6 }}>
                <a className="btn btn-sm" href={`/recipes/${r.id}`}>View</a>
                <a className="btn btn-sm" href={`/edit/recipe?id=${encodeURIComponent(r.id)}`}>Edit</a>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <span className="lbl">Meals ({data.meals.length})</span>
        <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0 }}>
          {data.meals.map((m) => (
            <li
              key={m.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                padding: "10px 0",
                borderBottom: "1px solid var(--hairline)",
              }}
            >
              <span>
                {m.name}
                <span style={{ color: "var(--muted)", fontSize: 13 }}>
                  {" "}· {m.components.length} recipes
                </span>
              </span>
              <a className="btn btn-sm" href={`/meals/${m.id}`}>View</a>
            </li>
          ))}
        </ul>
        <p style={{ marginTop: 10, fontSize: 13, color: "var(--muted)" }}>
          Meal editing lands with the planner in the next phase.
        </p>
      </section>

      {pending > 0 && (
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          {pending} edit{pending === 1 ? "" : "s"} shown from this browser are not in the published
          build yet.
        </p>
      )}
    </div>
  );
}
