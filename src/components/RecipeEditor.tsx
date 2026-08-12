import { useEffect, useMemo, useState } from "react";
import { UNIT_IDS, UNITS } from "../lib/units";
import { AISLES, type Aisle, type Ingredient, type Recipe } from "../lib/schema";
import {
  loadCookbook,
  saveRecipe,
  getToken,
  slugify,
  uniqueSlug,
  type Cookbook,
} from "../lib/store";

const NEW = "__new__";

const blankRecipe = (): Recipe => ({
  id: "",
  title: "",
  servings: 4,
  prepMin: 0,
  cookMin: 0,
  restMin: 0,
  tags: [],
  ingredients: [],
  steps: [],
});

type Row = Recipe["ingredients"][number];

export default function RecipeEditor() {
  const [cookbook, setCookbook] = useState<Cookbook | null>(null);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [ingredientsChanged, setIngredientsChanged] = useState(false);
  const [recipe, setRecipe] = useState<Recipe>(blankRecipe);
  const [isNew, setIsNew] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "warn" | "bad"; text: string; url?: string }>();
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    setHasToken(Boolean(getToken()));
    void (async () => {
      const { data, error } = await loadCookbook();
      setCookbook(data);
      setIngredients(data.ingredients);
      setLoadError(error);

      const id = new URLSearchParams(window.location.search).get("id");
      const existing = id ? data.recipes.find((r) => r.id === id) : undefined;
      if (existing) {
        setRecipe(structuredClone(existing));
        setIsNew(false);
      }
    })();
  }, []);

  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const sorted = useMemo(
    () => [...ingredients].sort((a, b) => a.name.localeCompare(b.name)),
    [ingredients],
  );

  const set = <K extends keyof Recipe>(key: K, value: Recipe[K]) =>
    setRecipe((r) => ({ ...r, [key]: value }));

  // --- ingredient rows -----------------------------------------------------

  const setRow = (index: number, patch: Partial<Row>) =>
    setRecipe((r) => ({
      ...r,
      ingredients: r.ingredients.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));

  const addRow = () =>
    setRecipe((r) => ({
      ...r,
      ingredients: [
        ...r.ingredients,
        { ingredientId: sorted[0]?.id ?? "", quantity: 1, unit: "each", optional: false, noScale: false },
      ],
    }));

  const removeRow = (index: number) =>
    setRecipe((r) => ({ ...r, ingredients: r.ingredients.filter((_, i) => i !== index) }));

  const moveRow = (index: number, delta: number) =>
    setRecipe((r) => {
      const next = [...r.ingredients];
      const target = index + delta;
      if (target < 0 || target >= next.length) return r;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...r, ingredients: next };
    });

  /** Create an ingredient inline so a recipe never blocks on missing data. */
  function createIngredient(rowIndex: number, name: string, aisle: Aisle) {
    const id = uniqueSlug(name, ingredients.map((i) => i.id));
    const created: Ingredient = { id, name: name.trim(), aisle, aliases: [], isStaple: false };
    setIngredients((list) => [...list, created]);
    setIngredientsChanged(true);
    setRow(rowIndex, { ingredientId: id });
  }

  // --- steps ---------------------------------------------------------------

  const setStep = (index: number, patch: Partial<Recipe["steps"][number]>) =>
    setRecipe((r) => ({
      ...r,
      steps: r.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));

  const addStep = () => setRecipe((r) => ({ ...r, steps: [...r.steps, { text: "" }] }));
  const removeStep = (index: number) =>
    setRecipe((r) => ({ ...r, steps: r.steps.filter((_, i) => i !== index) }));
  const moveStep = (index: number, delta: number) =>
    setRecipe((r) => {
      const next = [...r.steps];
      const target = index + delta;
      if (target < 0 || target >= next.length) return r;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...r, steps: next };
    });

  // --- validation ----------------------------------------------------------

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!recipe.title.trim()) list.push("Give the recipe a title.");
    if (recipe.servings <= 0) list.push("Servings must be at least 1.");
    if (recipe.ingredients.length === 0) list.push("Add at least one ingredient.");
    if (recipe.ingredients.some((row) => !row.ingredientId)) list.push("Every row needs an ingredient.");
    if (recipe.steps.length === 0) list.push("Add at least one step.");
    if (recipe.steps.some((s) => !s.text.trim())) list.push("Every step needs text.");
    return list;
  }, [recipe]);

  async function onSave() {
    setSaving(true);
    setResult(undefined);

    const id =
      recipe.id ||
      uniqueSlug(recipe.title, cookbook?.recipes.map((r) => r.id) ?? []);
    const toSave: Recipe = { ...recipe, id, ingredients: recipe.ingredients, steps: recipe.steps };

    const res = await saveRecipe(toSave, ingredients, { ingredientsChanged });
    setSaving(false);
    setRecipe(toSave);
    setIsNew(false);

    if (res.committed) {
      setIngredientsChanged(false);
      setResult({
        tone: "ok",
        text: "Saved and committed. The published site updates in about a minute.",
        url: res.url,
      });
    } else {
      setResult({
        tone: hasToken ? "bad" : "warn",
        text: res.error ?? "Could not commit.",
      });
    }
  }

  if (!cookbook) {
    return <p style={{ color: "var(--muted)" }}>Loading cookbook…</p>;
  }

  return (
    <div style={{ display: "grid", gap: 26 }}>
      {loadError && (
        <p className="card" style={{ padding: 14, color: "var(--accent)" }}>
          {loadError}
        </p>
      )}

      {!hasToken && (
        <p className="card" style={{ padding: "14px 16px", background: "var(--accent-wash)", borderColor: "transparent" }}>
          No token connected — you can draft here and it will be kept in this browser, but nothing
          will be committed. Connect one on the <a href="/edit">edit hub</a>.
        </p>
      )}

      {/* --- basics --- */}
      <section style={{ display: "grid", gap: 12 }}>
        <span className="lbl">Basics</span>
        <Field label="Title">
          <input
            className="input"
            value={recipe.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Greek Lemon Potatoes"
          />
        </Field>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <Field label="Subtitle" hint="Traditional or native name">
            <input
              className="input"
              value={recipe.subtitle ?? ""}
              onChange={(e) => set("subtitle", e.target.value || undefined)}
              placeholder="Patates Sto Fourno"
            />
          </Field>
          <Field label="Slug" hint={isNew ? "Generated from the title" : "Fixed once created"}>
            <input
              className="input"
              value={recipe.id || slugify(recipe.title)}
              readOnly
              style={{ color: "var(--muted)" }}
            />
          </Field>
        </div>
        <Field label="Description">
          <textarea
            className="textarea"
            value={recipe.description ?? ""}
            onChange={(e) => set("description", e.target.value || undefined)}
            placeholder="One or two lines on what makes it worth cooking."
          />
        </Field>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
          <Field label="Servings">
            <input
              className="input num"
              type="number"
              min={1}
              value={recipe.servings}
              onChange={(e) => set("servings", Number(e.target.value) || 1)}
            />
          </Field>
          <Field label="Prep (min)">
            <input className="input num" type="number" min={0} value={recipe.prepMin}
              onChange={(e) => set("prepMin", Number(e.target.value) || 0)} />
          </Field>
          <Field label="Cook (min)">
            <input className="input num" type="number" min={0} value={recipe.cookMin}
              onChange={(e) => set("cookMin", Number(e.target.value) || 0)} />
          </Field>
          <Field label="Chill (min)" hint="Inactive">
            <input className="input num" type="number" min={0} value={recipe.restMin}
              onChange={(e) => set("restMin", Number(e.target.value) || 0)} />
          </Field>
        </div>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <Field label="Yield note" hint="When a count beats servings">
            <input className="input" value={recipe.yieldNote ?? ""}
              onChange={(e) => set("yieldNote", e.target.value || undefined)}
              placeholder="12–14 small patties" />
          </Field>
          <Field label="Tags" hint="Comma separated">
            <input
              className="input"
              value={recipe.tags.join(", ")}
              onChange={(e) =>
                set("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))
              }
              placeholder="greek, main, vegetarian"
            />
          </Field>
        </div>
      </section>

      {/* --- ingredients --- */}
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span className="lbl">Ingredients</span>
          <button className="btn btn-sm" onClick={addRow}>+ Add ingredient</button>
        </div>

        {recipe.ingredients.length === 0 && (
          <p style={{ color: "var(--muted)", marginTop: 12 }}>No ingredients yet.</p>
        )}

        <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
          {recipe.ingredients.map((row, i) => (
            <IngredientRow
              key={i}
              row={row}
              index={i}
              total={recipe.ingredients.length}
              options={sorted}
              known={byId}
              onChange={(patch) => setRow(i, patch)}
              onCreate={(name, aisle) => createIngredient(i, name, aisle)}
              onRemove={() => removeRow(i)}
              onMove={(d) => moveRow(i, d)}
            />
          ))}
        </div>
      </section>

      {/* --- steps --- */}
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span className="lbl">Method</span>
          <button className="btn btn-sm" onClick={addStep}>+ Add step</button>
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
          {recipe.steps.map((step, i) => (
            <div key={i} className="card-soft" style={{ padding: 12, borderRadius: "var(--radius-sm)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="step-n num" style={{ fontSize: "1.05rem", minWidth: 20 }}>{i + 1}</span>
                <input
                  className="input"
                  value={step.heading ?? ""}
                  onChange={(e) => setStep(i, { heading: e.target.value || undefined })}
                  placeholder="Optional lead-in, e.g. Bind & Chill"
                  style={{ flex: 1 }}
                />
                <button className="btn btn-ghost btn-sm" onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label="Move step up">↑</button>
                <button className="btn btn-ghost btn-sm" onClick={() => moveStep(i, 1)} disabled={i === recipe.steps.length - 1} aria-label="Move step down">↓</button>
                <button className="btn btn-ghost btn-sm" onClick={() => removeStep(i)} aria-label="Remove step">✕</button>
              </div>
              <textarea
                className="textarea"
                style={{ marginTop: 8 }}
                value={step.text}
                onChange={(e) => setStep(i, { text: e.target.value })}
                placeholder="What to do."
              />
            </div>
          ))}
        </div>
      </section>

      <Field label="Notes">
        <textarea
          className="textarea"
          value={recipe.notes ?? ""}
          onChange={(e) => set("notes", e.target.value || undefined)}
          placeholder="Anything worth knowing that is not a step."
        />
      </Field>

      {/* --- save --- */}
      <section
        style={{
          position: "sticky",
          bottom: 0,
          background: "var(--bg)",
          borderTop: "1px solid var(--hairline)",
          padding: "14px 0",
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button className="btn btn-primary" onClick={onSave} disabled={saving || problems.length > 0}>
          {saving ? "Saving…" : isNew ? "Create recipe" : "Save changes"}
        </button>
        {recipe.id && !isNew && (
          <a className="btn" href={`/recipes/${recipe.id}`}>View</a>
        )}
        {problems.length > 0 && (
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{problems[0]}</span>
        )}
        {result && (
          <span
            role="status"
            style={{
              fontSize: 13,
              color: result.tone === "ok" ? "var(--olive)" : result.tone === "warn" ? "var(--muted)" : "var(--accent)",
            }}
          >
            {result.text}{" "}
            {result.url && (
              <a href={result.url} target="_blank" rel="noopener noreferrer">View commit →</a>
            )}
          </span>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block" }}>
      <span className="lbl" style={{ display: "block", marginBottom: 5 }}>
        {label}
        {hint && <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}> · {hint}</span>}
      </span>
      {children}
    </label>
  );
}

function IngredientRow({
  row,
  index,
  total,
  options,
  known,
  onChange,
  onCreate,
  onRemove,
  onMove,
}: {
  row: Row;
  index: number;
  total: number;
  options: Ingredient[];
  known: Map<string, Ingredient>;
  onChange: (patch: Partial<Row>) => void;
  onCreate: (name: string, aisle: Aisle) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAisle, setNewAisle] = useState<Aisle>("produce");

  const missing = row.ingredientId && !known.has(row.ingredientId);

  return (
    <div className="card-soft" style={{ padding: 12, borderRadius: "var(--radius-sm)" }}>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "90px 110px 1fr auto", alignItems: "center" }}>
        <input
          className="input num"
          type="number"
          step="0.01"
          min={0}
          value={row.quantity}
          onChange={(e) => onChange({ quantity: Number(e.target.value) || 0 })}
          aria-label="Quantity"
        />
        <select
          className="select"
          value={row.unit}
          onChange={(e) => onChange({ unit: e.target.value })}
          aria-label="Unit"
        >
          {UNIT_IDS.map((id) => (
            <option key={id} value={id}>
              {UNITS[id].label || "each"}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={row.ingredientId}
          onChange={(e) => {
            if (e.target.value === NEW) {
              setCreating(true);
              return;
            }
            onChange({ ingredientId: e.target.value });
          }}
          aria-label="Ingredient"
        >
          {missing && <option value={row.ingredientId}>⚠ {row.ingredientId} (missing)</option>}
          {!row.ingredientId && <option value="">Choose an ingredient…</option>}
          {options.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
          <option value={NEW}>+ New ingredient…</option>
        </select>
        <div style={{ display: "flex", gap: 2 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up">↑</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Move down">↓</button>
          <button className="btn btn-ghost btn-sm" onClick={onRemove} aria-label="Remove ingredient">✕</button>
        </div>
      </div>

      {creating && (
        <div
          style={{
            display: "grid",
            gap: 8,
            gridTemplateColumns: "1fr 140px auto auto",
            alignItems: "center",
            marginTop: 10,
            paddingTop: 10,
            borderTop: "1px solid var(--hairline)",
          }}
        >
          <input
            className="input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New ingredient name"
            autoFocus
          />
          <select className="select" value={newAisle} onChange={(e) => setNewAisle(e.target.value as Aisle)} aria-label="Aisle">
            {AISLES.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <button
            className="btn btn-sm btn-primary"
            disabled={!newName.trim()}
            onClick={() => {
              onCreate(newName, newAisle);
              setCreating(false);
              setNewName("");
            }}
          >
            Add
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>Cancel</button>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ flex: "1 1 220px", minHeight: 34, fontSize: 14 }}
          value={row.note ?? ""}
          onChange={(e) => onChange({ note: e.target.value || undefined })}
          placeholder="Preparation note, e.g. finely pressed"
        />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={row.optional} onChange={(e) => onChange({ optional: e.target.checked })} />
          Optional
        </label>
        <label
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
          title="Held fixed when the recipe is scaled — e.g. oil for frying"
        >
          <input type="checkbox" checked={row.noScale} onChange={(e) => onChange({ noScale: e.target.checked })} />
          Don't scale
        </label>
      </div>
    </div>
  );
}
