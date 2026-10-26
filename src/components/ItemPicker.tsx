import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Icon from "./Icon";
import { createIngredient } from "../lib/api";
import { isSavedName, parseItem, searchItems, stripAmount, type NewItem } from "../lib/list";
import { formatMoney } from "../lib/pricing";
import { uniqueSlug } from "../lib/slug";
import { AISLES, type Aisle } from "../lib/constants";
import type { Ingredient } from "../lib/schema";

interface Props {
  ingredients: Ingredient[];
  /** Ingredient ids already added to the list by hand, ticked in the dropdown. */
  listed: Set<string>;
  today: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onAdd: (item: NewItem) => void;
  /** A new item was saved to the library; the list needs it to name and price the line. */
  onCreated: (ingredient: Ingredient) => void;
  onError: (message: string) => void;
}

interface Draft {
  name: string;
  aisle: Aisle;
  price: string;
  label: string;
}

const SHOWN = 60;

/**
 * Add anything to the list: type to filter the saved items (everything in the
 * library, household things included), or open the dropdown to browse them by
 * aisle. Something not saved yet can be saved for next time, or added once.
 */
export default function ItemPicker({ ingredients, listed, today, inputRef, onAdd, onCreated, onError }: Props) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [aisle, setAisle] = useState<Aisle | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const results = useMemo(() => searchItems(ingredients, text, aisle ?? undefined), [ingredients, text, aisle]);
  const aisles = useMemo(() => AISLES.filter((a) => ingredients.some((i) => i.aisle === a)), [ingredients]);
  const name = stripAmount(text);
  const saved = isSavedName(ingredients, text);

  /** The typed amount carries over to whatever's picked: "2" + paper towels is two packs. */
  function itemFor(ingredient: Ingredient): NewItem {
    const parsed = parseItem(text, ingredients);
    if (parsed?.ingredientId === ingredient.id) return parsed;
    const raw = text.trim().replace(/\s+/g, " ");
    const amount = parseItem(`${raw.slice(0, raw.length - name.length)}${ingredient.name}`, [ingredient]);
    return amount?.ingredientId === ingredient.id ? amount : { ingredientId: ingredient.id };
  }

  function pick(ingredient: Ingredient) {
    onAdd(itemFor(ingredient));
    setText("");
  }

  function submit() {
    const parsed = parseItem(text, ingredients);
    if (!parsed) return;
    if (parsed.ingredientId) {
      onAdd(parsed);
      setText("");
      setOpen(false);
    } else {
      startNew();
    }
  }

  function startNew() {
    setDraft({ name: name.charAt(0).toUpperCase() + name.slice(1), aisle: aisle ?? "household", price: "", label: "" });
    setOpen(false);
  }

  async function saveNew() {
    if (!draft || !draft.name.trim()) return;
    const amount = Number(draft.price);
    const ingredient: Ingredient = {
      id: uniqueSlug(draft.name, ingredients.map((i) => i.id)),
      name: draft.name.trim(),
      aisle: draft.aisle,
      aliases: [],
      isStaple: false,
      // Bought by the package, so "2 paper towels" is two packs and prices as two.
      defaultUnit: "package",
      ...(amount > 0
        ? { price: { amount, quantity: 1, unit: "package", ...(draft.label.trim() ? { label: draft.label.trim() } : {}), asOf: today } }
        : {}),
    };
    setSaving(true);
    try {
      const { ingredient: created } = await createIngredient(ingredient);
      onCreated(created);
      const parsed = parseItem(text, [created]);
      onAdd(parsed?.ingredientId === created.id ? parsed : { ingredientId: created.id });
      setDraft(null);
      setText("");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save the item.");
    } finally {
      setSaving(false);
    }
  }

  /** On the list this time only, as free text: nothing saved. */
  function addOnce() {
    if (!draft?.name.trim()) return;
    const typed = parseItem(text, []);
    onAdd({
      name: draft.name.trim(),
      ...(typed?.quantity ? { quantity: typed.quantity } : {}),
      ...(typed?.unit ? { unit: typed.unit } : {}),
    });
    setDraft(null);
    setText("");
  }

  return (
    <div ref={wrap} style={{ position: "relative" }}>
      <form
        style={{ display: "flex", gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="search grow">
          <Icon name="search" />
          <input
            ref={inputRef}
            className="input"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
              setDraft(null);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Paper towels, 2 lb ground beef…"
            aria-label="Add an item"
            role="combobox"
            aria-expanded={open}
            aria-controls="item-picker"
            aria-autocomplete="list"
            enterKeyHint="done"
          />
        </div>
        <button
          type="button"
          className="btn btn-icon"
          aria-label={open ? "Close saved items" : "Browse saved items"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="chevronDown" />
        </button>
      </form>

      {open && (
        <div className="suggest item-picker" id="item-picker" role="listbox" aria-label="Saved items">
          <div className="chips item-aisles">
            <button type="button" className="chip" aria-pressed={aisle === null} onClick={() => setAisle(null)}>
              All
            </button>
            {aisles.map((a) => (
              <button key={a} type="button" className="chip" aria-pressed={aisle === a} onClick={() => setAisle(aisle === a ? null : a)}>
                {a}
              </button>
            ))}
          </div>
          {results.slice(0, SHOWN).map((i) => (
            <button
              key={i.id}
              type="button"
              className="menu-item"
              role="option"
              aria-selected={listed.has(i.id)}
              onClick={() => pick(i)}
            >
              <span className="aisle-dot" style={{ ["--aisle" as string]: `var(--aisle-${i.aisle})` }} />
              <span className="grow">
                {i.name}
                <span className="small muted" style={{ display: "block" }}>
                  {i.aisle}
                  {i.price ? ` · ${formatMoney(i.price.amount)}${i.price.label ? ` · ${i.price.label}` : ""}` : ""}
                </span>
              </span>
              {listed.has(i.id) && <Icon name="check" />}
            </button>
          ))}
          {name && !saved && (
            <button type="button" className="menu-item" role="option" aria-selected={false} onClick={startNew}>
              <Icon name="plus" />
              <span className="grow">
                Save “{name}” as a new item
                <span className="small muted" style={{ display: "block" }}>
                  It stays in this list for next time
                </span>
              </span>
            </button>
          )}
          {results.length > SHOWN && (
            <p className="small muted" style={{ padding: "6px 10px" }}>
              {results.length - SHOWN} more: type to narrow them down.
            </p>
          )}
          {results.length === 0 && !name && <p className="small muted" style={{ padding: "6px 10px" }}>Nothing saved in this aisle.</p>}
        </div>
      )}

      {draft && (
        <form
          className="soft new-item"
          onSubmit={(e) => {
            e.preventDefault();
            saveNew();
          }}
        >
          <strong style={{ fontSize: 14 }}>New item</strong>
          <input
            className="input input-sm"
            value={draft.name}
            aria-label="Item name"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            autoFocus
          />
          <div className="new-item-row">
            <select
              className="select select-sm"
              value={draft.aisle}
              aria-label="Aisle"
              onChange={(e) => setDraft({ ...draft, aisle: e.target.value as Aisle })}
            >
              {AISLES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <label className="price-field">
              $
              <input
                className="input input-sm num"
                inputMode="decimal"
                value={draft.price}
                placeholder="price"
                aria-label="Price for one package (optional)"
                onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              />
            </label>
          </div>
          <input
            className="input input-sm"
            value={draft.label}
            placeholder="Package (optional), e.g. 6 double rolls"
            aria-label="Package description (optional)"
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          />
          <div className="actions" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-primary" disabled={saving || !draft.name.trim()}>
              Save and add
            </button>
            <button type="button" className="btn btn-sm" disabled={saving} onClick={addOnce}>
              Add once
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
