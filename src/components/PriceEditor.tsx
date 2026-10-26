import { useMemo, useState } from "react";
import { saveIngredientPrice } from "../lib/api";
import { formatMoney } from "../lib/pricing";
import { UNITS, UNIT_IDS } from "../lib/units";
import type { Ingredient, Price } from "../lib/schema";

interface Props {
  ingredients: Ingredient[];
  /** How many recipes use each ingredient, so the ones that matter can lead. */
  usage: Record<string, number>;
  today: string;
}

interface Draft {
  amount: string;
  quantity: string;
  unit: string;
  label: string;
  store: string;
}

const toDraft = (i: Ingredient): Draft => ({
  amount: i.price ? String(i.price.amount) : "",
  quantity: i.price ? String(i.price.quantity) : "1",
  unit: i.price?.unit ?? i.defaultUnit ?? "each",
  label: i.price?.label ?? "",
  store: i.price?.store ?? "Walmart",
});

const unitLabel = (id: string) => (id === "each" ? "each" : UNITS[id]?.label || id);

/**
 * Every ingredient's package price, editable in place. Saving stamps today's
 * date, so an old price shows its age on the list's tooltip.
 */
export default function PriceEditor({ ingredients: initial, usage, today }: Props) {
  const [ingredients, setIngredients] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [query, setQuery] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ingredients
      .filter((i) => !missingOnly || !i.price)
      .filter((i) => !q || i.name.toLowerCase().includes(q) || i.aliases.some((a) => a.toLowerCase().includes(q)))
      .sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0) || a.name.localeCompare(b.name));
  }, [ingredients, query, missingOnly, usage]);

  const priced = ingredients.filter((i) => i.price).length;

  function edit(id: string, field: keyof Draft, value: string) {
    const base = drafts[id] ?? toDraft(ingredients.find((i) => i.id === id)!);
    setDrafts({ ...drafts, [id]: { ...base, [field]: value } });
  }

  async function save(ingredient: Ingredient, clear = false) {
    const d = drafts[ingredient.id] ?? toDraft(ingredient);
    let price: Price | null = null;
    if (!clear) {
      const amount = Number(d.amount);
      const quantity = Number(d.quantity);
      if (!(amount > 0) || !(quantity > 0)) {
        setError({ id: ingredient.id, text: "A price and a package size are both needed." });
        return;
      }
      price = {
        amount,
        quantity,
        unit: d.unit,
        ...(d.label.trim() ? { label: d.label.trim() } : {}),
        ...(d.store.trim() ? { store: d.store.trim() } : {}),
        asOf: today,
      };
    }
    setBusy(ingredient.id);
    setError(null);
    try {
      const { ingredient: saved } = await saveIngredientPrice(ingredient.id, price);
      setIngredients((all) => all.map((i) => (i.id === saved.id ? saved : i)));
      setDrafts(({ [ingredient.id]: _, ...rest }) => rest);
    } catch (e) {
      setError({ id: ingredient.id, text: e instanceof Error ? e.message : "Could not save the price." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="shop-toolbar" style={{ marginBottom: 12 }}>
        <input
          className="input"
          type="search"
          placeholder="Find an ingredient"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <label className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" className="check" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} />
          No price yet
        </label>
        <span className="small muted num">
          {priced} of {ingredients.length} priced
        </span>
      </div>

      <section className="panel" style={{ padding: "4px 14px" }}>
        {shown.map((ingredient) => {
          const d = drafts[ingredient.id] ?? toDraft(ingredient);
          const dirty = Boolean(drafts[ingredient.id]);
          const p = ingredient.price;
          return (
            <div className="price-row" key={ingredient.id}>
              <div className="price-name">
                {ingredient.name}
                <span className="shop-from">
                  {p
                    ? `${formatMoney(p.amount)} for ${p.quantity} ${unitLabel(p.unit)}${p.label ? ` · ${p.label}` : ""}${p.store ? ` · ${p.store}` : ""}${p.asOf ? ` · ${p.asOf}` : ""}`
                    : `No price · used in ${usage[ingredient.id] ?? 0} recipe${usage[ingredient.id] === 1 ? "" : "s"}`}
                </span>
                {error?.id === ingredient.id && (
                  <span className="shop-from" role="alert" style={{ color: "var(--danger, #b91c1c)" }}>
                    {error.text}
                  </span>
                )}
              </div>
              <label className="price-field">
                <span className="sr-only">Price in dollars</span>$
                <input
                  className="input input-sm num"
                  inputMode="decimal"
                  value={d.amount}
                  placeholder="0.00"
                  onChange={(e) => edit(ingredient.id, "amount", e.target.value)}
                />
              </label>
              <label className="price-field">
                <span className="muted small">for</span>
                <input
                  className="input input-sm num"
                  inputMode="decimal"
                  value={d.quantity}
                  aria-label="Package size"
                  onChange={(e) => edit(ingredient.id, "quantity", e.target.value)}
                />
                <select
                  className="select select-sm"
                  value={d.unit}
                  aria-label="Package unit"
                  onChange={(e) => edit(ingredient.id, "unit", e.target.value)}
                >
                  {UNIT_IDS.filter((u) => u !== "toTaste" && u !== "pinch").map((u) => (
                    <option key={u} value={u}>
                      {unitLabel(u)}
                    </option>
                  ))}
                </select>
              </label>
              <input
                className="input input-sm price-label"
                value={d.label}
                placeholder="Package, e.g. 24 oz jar"
                aria-label="Package description"
                onChange={(e) => edit(ingredient.id, "label", e.target.value)}
              />
              <div className="actions" style={{ gap: 6 }}>
                <button className="btn btn-sm btn-primary" disabled={!dirty || busy === ingredient.id} onClick={() => save(ingredient)}>
                  Save
                </button>
                {p && !dirty && (
                  <button className="btn btn-sm btn-ghost" disabled={busy === ingredient.id} onClick={() => save(ingredient, true)}>
                    Clear
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {shown.length === 0 && <p className="muted" style={{ padding: 12 }}>No ingredients match.</p>}
      </section>
    </div>
  );
}
