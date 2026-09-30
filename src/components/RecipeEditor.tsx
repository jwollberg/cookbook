import { useMemo, useRef, useState } from "react";
import Icon from "./Icon";
import { UNIT_IDS, UNITS } from "../lib/units";
import { AISLES, type Aisle } from "../lib/constants";
import type { Ingredient, Recipe } from "../lib/schema";
import { slugify, uniqueSlug } from "../lib/slug";
import { deleteRecipe, downsizePhoto, removePhoto, saveRecipe, uploadPhoto } from "../lib/api";

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
type Result = { tone: "ok" | "bad"; text: string };

interface Props {
  /** The recipe being edited, or null to create one. */
  initial: Recipe | null;
  ingredients: Ingredient[];
  /** Every recipe id already taken, so a new slug never collides. */
  takenIds: string[];
}

export default function RecipeEditor({ initial, ingredients: registry, takenIds }: Props) {
  const [ingredients, setIngredients] = useState<Ingredient[]>(registry);
  const [created, setCreated] = useState<Ingredient[]>([]);
  const [recipe, setRecipe] = useState<Recipe>(() => (initial ? structuredClone(initial) : blankRecipe()));
  const [isNew, setIsNew] = useState(!initial);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [result, setResult] = useState<Result>();
  const fileInput = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const sorted = useMemo(() => [...ingredients].sort((a, b) => a.name.localeCompare(b.name)), [ingredients]);

  const set = <K extends keyof Recipe>(key: K, value: Recipe[K]) => setRecipe((r) => ({ ...r, [key]: value }));

  // --- ingredient rows -----------------------------------------------------

  const setRow = (index: number, patch: Partial<Row>) =>
    setRecipe((r) => ({
      ...r,
      ingredients: r.ingredients.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));

  const addRow = () =>
    setRecipe((r) => ({
      ...r,
      ingredients: [...r.ingredients, { ingredientId: "", quantity: 1, unit: "each", optional: false, noScale: false }],
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
    const ingredient: Ingredient = { id, name: name.trim(), aisle, aliases: [], isStaple: false };
    setIngredients((list) => [...list, ingredient]);
    setCreated((list) => [...list, ingredient]);
    setRow(rowIndex, { ingredientId: id });
  }

  // --- steps ---------------------------------------------------------------

  const setStep = (index: number, patch: Partial<Recipe["steps"][number]>) =>
    setRecipe((r) => ({ ...r, steps: r.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  const addStep = () => setRecipe((r) => ({ ...r, steps: [...r.steps, { text: "" }] }));
  const removeStep = (index: number) => setRecipe((r) => ({ ...r, steps: r.steps.filter((_, i) => i !== index) }));
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

  // --- save ------------------------------------------------------------------

  async function onSave() {
    setSaving(true);
    setResult(undefined);
    const id = recipe.id || uniqueSlug(recipe.title, takenIds);
    try {
      // Only ingredients still used by a row are worth creating.
      const used = new Set(recipe.ingredients.map((r) => r.ingredientId));
      let { recipe: saved } = await saveRecipe(
        { ...recipe, id },
        created.filter((i) => used.has(i.id)),
      );
      setCreated([]);
      if (pendingPhoto) {
        ({ recipe: saved } = await uploadPhoto(saved.id, pendingPhoto.blob));
        URL.revokeObjectURL(pendingPhoto.url);
        setPendingPhoto(null);
      }
      setRecipe(saved);
      if (isNew) {
        setIsNew(false);
        window.history.replaceState(null, "", `/edit/recipe?id=${encodeURIComponent(saved.id)}`);
      }
      setResult({ tone: "ok", text: "Saved — live for everyone now." });
    } catch (error) {
      setResult({ tone: "bad", text: error instanceof Error ? error.message : "Could not save." });
    } finally {
      setSaving(false);
    }
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    setResult(undefined);
    try {
      const blob = await downsizePhoto(file);
      if (isNew) {
        // Nothing to attach it to until the recipe exists; it goes up on save.
        if (pendingPhoto) URL.revokeObjectURL(pendingPhoto.url);
        setPendingPhoto({ blob, url: URL.createObjectURL(blob) });
      } else {
        const { recipe: saved } = await uploadPhoto(recipe.id, blob);
        setRecipe((r) => ({ ...r, image: saved.image, imageCredit: saved.imageCredit, updatedAt: saved.updatedAt }));
        setResult({ tone: "ok", text: "Photo saved." });
      }
    } catch (error) {
      setResult({ tone: "bad", text: error instanceof Error ? error.message : "Could not use that photo." });
    } finally {
      setPhotoBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function onRemovePhoto() {
    if (pendingPhoto) {
      URL.revokeObjectURL(pendingPhoto.url);
      setPendingPhoto(null);
      return;
    }
    if (!window.confirm("Remove this recipe's photo?")) return;
    setPhotoBusy(true);
    try {
      const { recipe: saved } = await removePhoto(recipe.id);
      setRecipe((r) => ({ ...r, image: saved.image, imageCredit: saved.imageCredit }));
    } catch (error) {
      setResult({ tone: "bad", text: error instanceof Error ? error.message : "Could not remove the photo." });
    } finally {
      setPhotoBusy(false);
    }
  }

  async function onDelete() {
    if (!window.confirm(`Delete “${recipe.title}” for everyone? This cannot be undone.`)) return;
    try {
      await deleteRecipe(recipe.id);
      window.location.assign("/edit?deleted=1");
    } catch (error) {
      setResult({ tone: "bad", text: error instanceof Error ? error.message : "Could not delete." });
    }
  }

  const photo = pendingPhoto?.url ?? recipe.image;

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 880 }}>
      {/* --- photo --- */}
      <section className="panel panel-pad" style={{ display: "grid", gap: 14 }}>
        <h2 style={{ fontSize: "1.15rem" }}>Photo</h2>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
          <div className="rcard-media" style={{ width: 220, flex: "none" }}>
            {photo ? (
              <img src={photo} alt="" />
            ) : (
              <div className="no-photo">
                <Icon name="camera" />
              </div>
            )}
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="sr-only"
              id="photo-input"
              onChange={(e) => void onPhoto(e.target.files?.[0])}
            />
            <div className="actions">
              <label htmlFor="photo-input" className="btn" aria-disabled={photoBusy}>
                <Icon name={photo ? "camera" : "upload"} />
                {photoBusy ? "Working…" : photo ? "Replace photo" : "Add a photo"}
              </label>
              {photo && (
                <button className="btn btn-ghost" onClick={() => void onRemovePhoto()} disabled={photoBusy}>
                  Remove
                </button>
              )}
            </div>
            <p className="small muted" style={{ maxWidth: 360 }}>
              {pendingPhoto
                ? "Uploads when you create the recipe."
                : recipe.imageCredit
                  ? `Current photo: ${recipe.imageCredit.author}, ${recipe.imageCredit.license}.`
                  : "Snap it on your phone or pick a file — it is resized before upload."}
            </p>
          </div>
        </div>
      </section>

      {/* --- basics --- */}
      <section className="panel panel-pad" style={{ display: "grid", gap: 14 }}>
        <h2 style={{ fontSize: "1.15rem" }}>Basics</h2>
        <Field label="Title">
          <input className="input" value={recipe.title} onChange={(e) => set("title", e.target.value)} placeholder="Greek Lemon Potatoes" />
        </Field>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <Field label="Subtitle" hint="Traditional or native name">
            <input
              className="input"
              value={recipe.subtitle ?? ""}
              onChange={(e) => set("subtitle", e.target.value || undefined)}
              placeholder="Patates Sto Fourno"
            />
          </Field>
          <Field label="Address" hint={isNew ? "Made from the title" : "Fixed once created"}>
            <input className="input" value={`/recipes/${recipe.id || slugify(recipe.title)}`} readOnly style={{ color: "var(--muted)" }} />
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
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
          <Field label="Servings">
            <input className="input num" type="number" min={1} value={recipe.servings} onChange={(e) => set("servings", Number(e.target.value) || 1)} />
          </Field>
          <Field label="Prep (min)">
            <input className="input num" type="number" min={0} value={recipe.prepMin} onChange={(e) => set("prepMin", Number(e.target.value) || 0)} />
          </Field>
          <Field label="Cook (min)">
            <input className="input num" type="number" min={0} value={recipe.cookMin} onChange={(e) => set("cookMin", Number(e.target.value) || 0)} />
          </Field>
          <Field label="Chill (min)" hint="Hands-off">
            <input className="input num" type="number" min={0} value={recipe.restMin} onChange={(e) => set("restMin", Number(e.target.value) || 0)} />
          </Field>
        </div>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <Field label="Yield" hint="When a count beats servings">
            <input className="input" value={recipe.yieldNote ?? ""} onChange={(e) => set("yieldNote", e.target.value || undefined)} placeholder="12–14 small patties" />
          </Field>
          <Field label="Tags" hint="Comma separated">
            <input
              className="input"
              value={recipe.tags.join(", ")}
              onChange={(e) => set("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))}
              placeholder="greek, main, vegetarian"
            />
          </Field>
        </div>
      </section>

      {/* --- ingredients --- */}
      <section className="panel panel-pad" style={{ display: "grid", gap: 12 }}>
        <div className="actions" style={{ justifyContent: "space-between" }}>
          <h2 style={{ fontSize: "1.15rem" }}>Ingredients</h2>
          <button className="btn btn-sm" onClick={addRow}>
            <Icon name="plus" /> Add ingredient
          </button>
        </div>
        {recipe.ingredients.length === 0 && <p className="muted">No ingredients yet.</p>}
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
      </section>

      {/* --- steps --- */}
      <section className="panel panel-pad" style={{ display: "grid", gap: 12 }}>
        <div className="actions" style={{ justifyContent: "space-between" }}>
          <h2 style={{ fontSize: "1.15rem" }}>Method</h2>
          <button className="btn btn-sm" onClick={addStep}>
            <Icon name="plus" /> Add step
          </button>
        </div>
        {recipe.steps.map((step, i) => (
          <div key={i} className="soft" style={{ padding: 12, display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="step-n">{i + 1}</span>
              <input
                className="input input-sm"
                value={step.heading ?? ""}
                onChange={(e) => setStep(i, { heading: e.target.value || undefined })}
                placeholder="Optional lead-in, e.g. Bind & Chill"
                style={{ flex: 1 }}
              />
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label="Move step up">
                <Icon name="chevronDown" className="flip" />
              </button>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => moveStep(i, 1)} disabled={i === recipe.steps.length - 1} aria-label="Move step down">
                <Icon name="chevronDown" />
              </button>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeStep(i)} aria-label="Remove step">
                <Icon name="x" />
              </button>
            </div>
            <textarea className="textarea" value={step.text} onChange={(e) => setStep(i, { text: e.target.value })} placeholder="What to do." />
          </div>
        ))}
      </section>

      <section className="panel panel-pad">
        <Field label="Notes">
          <textarea
            className="textarea"
            value={recipe.notes ?? ""}
            onChange={(e) => set("notes", e.target.value || undefined)}
            placeholder="Anything worth knowing that is not a step."
          />
        </Field>
      </section>

      {/* --- save --- */}
      <div
        className="actions"
        style={{
          position: "sticky",
          bottom: "calc(var(--tabbar-h) + env(safe-area-inset-bottom))",
          zIndex: 5,
          padding: "14px 0",
          background: "var(--bg)",
          borderTop: "1px solid var(--hairline)",
        }}
      >
        <button className="btn btn-primary" onClick={() => void onSave()} disabled={saving || problems.length > 0}>
          {saving ? "Saving…" : isNew ? "Create recipe" : "Save changes"}
        </button>
        {!isNew && (
          <a className="btn" href={`/recipes/${recipe.id}`}>
            View
          </a>
        )}
        {problems.length > 0 && <span className="small muted">{problems[0]}</span>}
        {result && (
          <span role="status" className="small" style={{ color: result.tone === "ok" ? "var(--green)" : "var(--accent)", fontWeight: 600 }}>
            {result.text}
          </span>
        )}
        {!isNew && (
          <button className="btn btn-ghost btn-danger btn-sm" style={{ marginLeft: "auto" }} onClick={() => void onDelete()}>
            <Icon name="trash" /> Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint && <span className="field-hint"> · {hint}</span>}
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
    <div className="soft" style={{ padding: 12, display: "grid", gap: 8 }}>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "84px 100px minmax(0, 1fr) auto", alignItems: "center" }}>
        <input
          className="input input-sm num"
          type="number"
          step="0.01"
          min={0}
          value={row.quantity}
          onChange={(e) => onChange({ quantity: Number(e.target.value) || 0 })}
          aria-label="Quantity"
        />
        <select className="select select-sm" value={row.unit} onChange={(e) => onChange({ unit: e.target.value })} aria-label="Unit">
          {UNIT_IDS.map((id) => (
            <option key={id} value={id}>
              {UNITS[id].label || "each"}
            </option>
          ))}
        </select>
        <select
          className="select select-sm"
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
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up">
            <Icon name="chevronDown" className="flip" />
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Move down">
            <Icon name="chevronDown" />
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onRemove} aria-label="Remove ingredient">
            <Icon name="x" />
          </button>
        </div>
      </div>

      {creating && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", paddingTop: 8, borderTop: "1px solid var(--hairline)" }}>
          <input
            className="input input-sm"
            style={{ flex: "1 1 180px" }}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New ingredient name"
            autoFocus
          />
          <select className="select select-sm" style={{ width: "auto" }} value={newAisle} onChange={(e) => setNewAisle(e.target.value as Aisle)} aria-label="Aisle">
            {AISLES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
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
          <button className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input input-sm"
          style={{ flex: "1 1 220px" }}
          value={row.note ?? ""}
          onChange={(e) => onChange({ note: e.target.value || undefined })}
          placeholder="Preparation note, e.g. finely chopped"
        />
        <label className="small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" className="check" checked={row.optional} onChange={(e) => onChange({ optional: e.target.checked })} />
          Optional
        </label>
        <label className="small" style={{ display: "flex", alignItems: "center", gap: 6 }} title="Held fixed when the recipe is scaled — e.g. oil for frying">
          <input type="checkbox" className="check" checked={row.noScale} onChange={(e) => onChange({ noScale: e.target.checked })} />
          Don't scale
        </label>
      </div>
    </div>
  );
}
