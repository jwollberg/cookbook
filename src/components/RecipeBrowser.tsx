import { useMemo, useState } from "react";
import Icon from "./Icon";
import { Toast, useList } from "./useList";
import type { RecipeCard } from "../lib/format";
import type { ShoppingExtras } from "../lib/schema";

interface Props {
  recipes: RecipeCard[];
  tags?: string[];
  householdId: string;
  extras: ShoppingExtras;
  /** Show the search box and tag filters. Off for the home page's short grid. */
  searchable?: boolean;
  /** Pre-fill the search, e.g. from /recipes?q=. */
  initialQuery?: string;
  initialTags?: string[];
}

export default function RecipeBrowser({
  recipes,
  tags = [],
  householdId,
  extras,
  searchable = true,
  initialQuery = "",
  initialTags = [],
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState<string[]>(initialTags);
  const list = useList(householdId, extras);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      // Tags are AND, not OR — narrowing is what a filter is for. "greek"
      // plus "side" should mean Greek sides, not everything Greek or any side.
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
      {searchable && (
        <div style={{ display: "grid", gap: 14, marginBottom: 28 }}>
          <div className="search" style={{ maxWidth: 520 }}>
            <Icon name="search" />
            <input
              className="input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search recipes, ingredients, tags…"
              aria-label="Search recipes"
            />
          </div>
          {tags.length > 0 && (
            <div className="chips" role="group" aria-label="Filter by tag">
              {tags.map((tag) => (
                <button key={tag} className="chip" aria-pressed={active.includes(tag)} onClick={() => toggle(tag)}>
                  {tag}
                </button>
              ))}
              {active.length > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={() => setActive([])}>
                  Clear
                </button>
              )}
            </div>
          )}
          <p className="small muted num" aria-live="polite">
            {filtered.length === recipes.length
              ? `${recipes.length} recipe${recipes.length === 1 ? "" : "s"}`
              : `${filtered.length} of ${recipes.length}`}
          </p>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty">
          <p>Nothing matches that. Try another search or clear the filters.</p>
        </div>
      ) : (
        <div className="card-grid">
          {filtered.map((r) => {
            const onList = Boolean(list.has({ recipeId: r.id }));
            return (
              <article key={r.id} className="rcard">
                <div className="rcard-media">
                  {r.image ? (
                    <img src={r.image} alt="" loading="lazy" />
                  ) : (
                    <div className="no-photo">
                      <Icon name="pot" />
                    </div>
                  )}
                  <button
                    className="quick-add"
                    aria-pressed={onList}
                    disabled={list.busy}
                    aria-label={onList ? `Remove ${r.title} from the shopping list` : `Add ${r.title} to the shopping list`}
                    title={onList ? "On the shopping list" : "Add to the shopping list"}
                    onClick={() =>
                      onList ? list.remove({ recipeId: r.id }, r.title) : list.add({ recipeId: r.id }, r.title)
                    }
                  >
                    <Icon name={onList ? "check" : "plus"} />
                  </button>
                </div>
                <div>
                  <a className="rcard-link" href={`/recipes/${r.id}`}>
                    <h3 className="rcard-title">{r.title}</h3>
                  </a>
                  {r.subtitle && <p className="rcard-sub">{r.subtitle}</p>}
                  <div className="rcard-meta">
                    {r.timeLabel && (
                      <span>
                        <Icon name="clock" />
                        {r.timeLabel}
                      </span>
                    )}
                    <span>
                      <Icon name="users" />
                      Serves {r.servings}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Toast toast={list.toast} />
    </div>
  );
}
