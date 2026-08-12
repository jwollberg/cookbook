import { useMemo, useState } from "react";

export interface RecipeCard {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  image?: string;
  tags: string[];
  servings: number;
  timeLabel: string | null;
}

interface Props {
  recipes: RecipeCard[];
  tags: string[];
  /** Where cards link to. */
  basePath?: string;
}

export default function RecipeBrowser({ recipes, tags, basePath = "/recipes" }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      // Tags are AND, not OR — narrowing is what a filter is for. "greek" plus
      // "side" should mean Greek sides, not everything Greek or any side.
      if (active.length && !active.every((t) => r.tags.includes(t))) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.subtitle?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [recipes, query, active]);

  const toggle = (tag: string) =>
    setActive((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search recipes…"
          aria-label="Search recipes"
          style={{ flex: "1 1 260px", maxWidth: 380 }}
        />
        <span className="num" style={{ fontSize: 13, color: "var(--muted)" }}>
          {filtered.length} of {recipes.length}
        </span>
      </div>

      {tags.length > 0 && (
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 14 }}>
          {tags.map((tag) => {
            const on = active.includes(tag);
            return (
              <button
                key={tag}
                onClick={() => toggle(tag)}
                aria-pressed={on}
                className={on ? "chip chip-accent" : "chip"}
                style={{
                  border: "1px solid transparent",
                  borderColor: on ? "var(--accent)" : "var(--hairline)",
                  cursor: "pointer",
                  minHeight: 30,
                }}
              >
                {tag}
              </button>
            );
          })}
          {active.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setActive([])}>
              Clear
            </button>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <p style={{ marginTop: 32, color: "var(--muted)" }}>
          Nothing matches that. Try a different search or clear the filters.
        </p>
      ) : (
        <div className="grid-recipes" style={{ marginTop: 24 }}>
          {filtered.map((r) => (
            <a key={r.id} className="card card-interactive recipe-card" href={`${basePath}/${r.id}`}>
              {r.image ? (
                <img className="recipe-card-img" src={r.image} alt="" loading="lazy" />
              ) : (
                <div className="recipe-card-img recipe-card-img--empty" aria-hidden="true" />
              )}
              <div style={{ padding: "16px 18px 18px" }}>
                <h2 style={{ fontSize: "1.25rem" }}>{r.title}</h2>
                {r.subtitle && (
                  <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--muted)", fontStyle: "italic" }}>
                    {r.subtitle}
                  </p>
                )}
                <div
                  style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}
                >
                  {r.timeLabel && <span className="chip num">{r.timeLabel}</span>}
                  <span className="chip num">Serves {r.servings}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
