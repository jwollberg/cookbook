import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";
import { Toast, type ToastMessage } from "./useList";
import { announceList, editList, fetchList, type ListState } from "../lib/api";
import { buildShoppingList, expandDishes, expandPlan, type ShoppingLine } from "../lib/shopping";
import { applyListEdit, describeItem, newItemId, parseItem } from "../lib/list";
import { entryCount, pickCurrentPlan, resolvePlan } from "../lib/plans";
import { formatRange } from "../lib/dates";
import type {
  Ingredient,
  ListEdit,
  Meal,
  MealPlan,
  PantryItem,
  Recipe,
  ShoppingExtras,
} from "../lib/schema";

interface Props {
  householdId: string;
  householdName: string;
  ingredients: Ingredient[];
  recipes: Recipe[];
  meals: Meal[];
  plans: MealPlan[];
  pantry: PantryItem[];
  extras: ShoppingExtras;
  ticked: string[];
  today: string;
}

interface Pickable {
  kind: "recipe" | "meal";
  id: string;
  title: string;
  sub: string;
  image?: string;
}

const planLabel = (plan: MealPlan) =>
  `${formatRange(plan.days[0].date, plan.days[plan.days.length - 1].date)} · ${entryCount(plan)} planned`;

export default function ShoppingList(props: Props) {
  const { householdId, householdName, ingredients, recipes, meals, plans, pantry, today } = props;

  const [extras, setExtras] = useState(props.extras);
  const [ticked, setTicked] = useState(() => new Set(props.ticked));
  const [includeStaples, setIncludeStaples] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [itemText, setItemText] = useState("");
  const [dishQuery, setDishQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  // Responses can overtake one another when ticking fast in a shop. Only the
  // newest request's answer is applied; the optimistic state already shows
  // everything asked for, so an older answer would only undo a newer tap.
  const seq = useRef(0);
  const pending = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const recipesById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const mealsById = useMemo(() => new Map(meals.map((m) => [m.id, m])), [meals]);
  const ingredientsById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const plan = resolvePlan(plans, extras.planId, today);
  const autoPlan = pickCurrentPlan(plans, today);
  const choosable = plans.filter((p) => entryCount(p) > 0);

  const list = useMemo(() => {
    const dishes = [
      ...(plan ? expandPlan(plan, recipesById, mealsById) : []),
      ...expandDishes(extras.dishes, recipesById, mealsById),
    ];
    return buildShoppingList(dishes, ingredientsById, { pantry, includeStaples, items: extras.items });
  }, [plan, extras, recipesById, mealsById, ingredientsById, pantry, includeStaples]);

  const lines = list.groups.flatMap((g) => g.lines);
  const toBuy = lines.filter((l) => !l.covered);
  const done = toBuy.filter((l) => ticked.has(l.key)).length;
  const hasAnything = lines.length > 0;

  // An empty list opens the builder on a phone; a full one leads with the list.
  useEffect(() => setBuilderOpen(!hasAnything), []); // eslint-disable-line react-hooks/exhaustive-deps

  function show(message: ToastMessage) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3600);
  }

  function apply(state: ListState) {
    setExtras(state.extras);
    setTicked(new Set(state.ticked));
  }

  async function send(edit: ListEdit, optimistic: () => void) {
    optimistic();
    const mine = ++seq.current;
    pending.current++;
    try {
      const state = await editList(householdId, edit);
      if (mine === seq.current) apply(state);
    } catch (error) {
      show({ text: error instanceof Error ? error.message : "Could not update the list." });
      // Resync rather than roll back: other edits may have landed meanwhile.
      fetchList(householdId).then(apply, () => undefined);
    } finally {
      pending.current--;
    }
  }

  const edit = (e: ListEdit) => send(e, () => setExtras((x) => applyListEdit(x, e, newItemId())));

  // Two phones in one shop: pick up the other person's ticks when this tab
  // comes back into view.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible" || pending.current > 0) return;
      const mine = ++seq.current;
      fetchList(householdId).then(
        (state) => {
          if (mine === seq.current) {
            apply(state);
            announceList(state.extras);
          }
        },
        () => undefined,
      );
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [householdId]);

  function toggle(line: ShoppingLine) {
    const on = !ticked.has(line.key);
    send({ type: "tick", key: line.key, on }, () =>
      setTicked((prev) => {
        const next = new Set(prev);
        if (on) next.add(line.key);
        else next.delete(line.key);
        return next;
      }),
    );
  }

  // --- adding things -----------------------------------------------------

  const parsed = useMemo(() => parseItem(itemText, ingredients), [itemText, ingredients]);
  const preview = parsed ? describeItem({ id: "preview", ...parsed }, ingredientsById) : "";
  const previewAisle = parsed?.ingredientId ? ingredientsById.get(parsed.ingredientId)?.aisle : undefined;

  function addTyped() {
    if (!parsed) return;
    edit({ type: "addItem", item: parsed });
    setItemText("");
  }

  const pickables: Pickable[] = useMemo(
    () => [
      ...meals.map((m) => ({
        kind: "meal" as const,
        id: m.id,
        title: m.name,
        sub: `Meal · ${m.components.length} dishes`,
        image: recipesById.get(m.components.find((c) => c.role === "main")?.recipeId ?? "")?.image,
      })),
      ...recipes.map((r) => ({
        kind: "recipe" as const,
        id: r.id,
        title: r.title,
        sub: `Recipe · serves ${r.servings}`,
        image: r.image,
      })),
    ],
    [meals, recipes, recipesById],
  );
  const matches = useMemo(() => {
    const q = dishQuery.trim().toLowerCase();
    return (q ? pickables.filter((p) => p.title.toLowerCase().includes(q)) : pickables).slice(0, 8);
  }, [dishQuery, pickables]);

  const isListed = (p: Pickable) =>
    extras.dishes.some((d) => (p.kind === "meal" ? d.mealId === p.id : d.recipeId === p.id));

  function pick(p: Pickable) {
    if (!isListed(p)) {
      edit({ type: "addDish", dish: p.kind === "meal" ? { mealId: p.id } : { recipeId: p.id } });
    }
    setDishQuery("");
    setPickerOpen(false);
  }

  // --- render --------------------------------------------------------------

  const summary = [
    plan ? `Plan ${formatRange(plan.days[0].date, plan.days[6]?.date ?? plan.days[0].date)}` : "No plan",
    extras.dishes.length ? `${extras.dishes.length} dish${extras.dishes.length === 1 ? "" : "es"}` : null,
    extras.items.length ? `${extras.items.length} item${extras.items.length === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="shop-layout">
      {/* ---------------- builder ---------------- */}
      <aside className={builderOpen ? "builder" : "builder is-collapsed"}>
        <button
          className="builder-toggle"
          onClick={() => setBuilderOpen((o) => !o)}
          aria-expanded={builderOpen}
        >
          <span>
            <strong>What's on the list</strong>
            <span className="small muted" style={{ display: "block" }}>
              {summary}
            </span>
          </span>
          <Icon name="chevronDown" />
        </button>

        <div className="builder-body panel panel-pad">
          {/* plan */}
          <section className="builder-section">
            <label className="field">
              <span className="field-label">From the plan</span>
              <select
                className="select"
                value={extras.planId === null ? "none" : (extras.planId ?? "auto")}
                onChange={(e) => {
                  const v = e.target.value;
                  edit({ type: "setPlan", planId: v === "auto" ? "auto" : v === "none" ? null : v });
                }}
              >
                <option value="auto">
                  This week{autoPlan ? ` — ${planLabel(autoPlan)}` : " — nothing planned"}
                </option>
                {choosable
                  .filter((p) => p.id !== autoPlan?.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {planLabel(p)}
                    </option>
                  ))}
                <option value="none">No plan — just what I add</option>
              </select>
            </label>
            <a className="small" href="/plan" style={{ color: "var(--accent)", fontWeight: 600 }}>
              Open the planner
            </a>
          </section>

          {/* recipes and meals */}
          <section className="builder-section">
            <span className="field-label">Recipes and meals</span>
            {extras.dishes.length > 0 && (
              <div>
                {extras.dishes.map((dish) => {
                  const recipe = dish.recipeId ? recipesById.get(dish.recipeId) : undefined;
                  const meal = dish.mealId ? mealsById.get(dish.mealId) : undefined;
                  const ref = dish.recipeId ? { recipeId: dish.recipeId } : { mealId: dish.mealId };
                  const title = recipe?.title ?? meal?.name ?? "Removed recipe";
                  const image =
                    recipe?.image ??
                    (meal
                      ? recipesById.get(meal.components.find((c) => c.role === "main")?.recipeId ?? "")?.image
                      : undefined);
                  const servings = dish.servings ?? recipe?.servings ?? 4;
                  return (
                    <div className="source-row" key={dish.recipeId ?? `m:${dish.mealId}`}>
                      {image ? <img className="source-thumb" src={image} alt="" /> : <span className="source-thumb" />}
                      <span className="source-title">
                        <a href={recipe ? `/recipes/${recipe.id}` : meal ? `/meals/${meal.id}` : "#"} style={{ textDecoration: "none" }}>
                          {title}
                        </a>
                        <span className="small muted" style={{ display: "block", fontWeight: 400 }}>
                          {meal ? `Meal · ${meal.components.length} dishes` : "Servings"}
                        </span>
                      </span>
                      {recipe && (
                        <div className="stepper stepper-sm">
                          <button
                            aria-label={`Fewer servings of ${title}`}
                            disabled={servings <= 1}
                            onClick={() => edit({ type: "setServings", ref, servings: servings - 1 })}
                          >
                            <Icon name="minus" />
                          </button>
                          <output>{servings}</output>
                          <button
                            aria-label={`More servings of ${title}`}
                            disabled={servings >= 99}
                            onClick={() => edit({ type: "setServings", ref, servings: servings + 1 })}
                          >
                            <Icon name="plus" />
                          </button>
                        </div>
                      )}
                      <button
                        className="btn btn-ghost btn-icon btn-sm"
                        aria-label={`Remove ${title}`}
                        onClick={() => edit({ type: "removeDish", ref })}
                      >
                        <Icon name="x" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ position: "relative" }}>
              <div className="search">
                <Icon name="plus" />
                <input
                  className="input"
                  value={dishQuery}
                  onChange={(e) => {
                    setDishQuery(e.target.value);
                    setPickerOpen(true);
                  }}
                  onFocus={() => setPickerOpen(true)}
                  onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && matches[0]) {
                      e.preventDefault();
                      pick(matches[0]);
                    }
                    if (e.key === "Escape") setPickerOpen(false);
                  }}
                  placeholder="Add a recipe or meal…"
                  aria-label="Add a recipe or meal"
                  role="combobox"
                  aria-expanded={pickerOpen}
                  aria-controls="dish-picker"
                  aria-autocomplete="list"
                />
              </div>
              {pickerOpen && matches.length > 0 && (
                <div className="suggest" id="dish-picker" role="listbox">
                  {matches.map((p) => {
                    const listed = isListed(p);
                    return (
                      <button
                        key={`${p.kind}:${p.id}`}
                        className="menu-item"
                        role="option"
                        aria-selected={false}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(p)}
                      >
                        {p.image ? (
                          <img className="source-thumb" style={{ width: 36, height: 36 }} src={p.image} alt="" />
                        ) : (
                          <span className="source-thumb" style={{ width: 36, height: 36 }} />
                        )}
                        <span className="grow">
                          {p.title}
                          <span className="small muted" style={{ display: "block" }}>
                            {p.sub}
                          </span>
                        </span>
                        {listed && <Icon name="check" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* loose items */}
          <section className="builder-section">
            <span className="field-label">Anything else</span>
            <form
              style={{ display: "flex", gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                addTyped();
              }}
            >
              <input
                className="input"
                value={itemText}
                onChange={(e) => setItemText(e.target.value)}
                placeholder="2 lb ground beef, milk, paper towels…"
                aria-label="Add an item"
                enterKeyHint="done"
              />
              <button className="btn btn-dark btn-icon" disabled={!parsed} aria-label="Add item">
                <Icon name="plus" />
              </button>
            </form>
            {parsed && (
              <p className="small muted" aria-live="polite">
                Adds <strong style={{ color: "var(--ink)" }}>{preview}</strong>
                {previewAisle ? ` · ${previewAisle}` : " · other"}
                {parsed.ingredientId ? " — merges with any recipe that needs it" : ""}
              </p>
            )}
            {extras.items.length > 0 && (
              <div className="chips">
                {extras.items.map((item) => (
                  <span key={item.id} className="chip" style={{ paddingRight: 4 }}>
                    {describeItem(item, ingredientsById)}
                    <button
                      className="btn btn-ghost btn-icon"
                      style={{ minHeight: 26, width: 26, padding: 0 }}
                      aria-label={`Remove ${describeItem(item, ingredientsById)}`}
                      onClick={() => edit({ type: "removeItem", id: item.id })}
                    >
                      <Icon name="x" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>

      {/* ---------------- the list ---------------- */}
      <section className="shop-list">
        <div className="shop-toolbar no-print">
          <span className="num" style={{ fontWeight: 650 }}>
            {toBuy.length === 0 ? "Nothing to buy yet" : `${done} of ${toBuy.length} in the cart`}
          </span>
          <div className="actions" style={{ gap: 6 }}>
            <label className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginRight: 4 }}>
              <input
                type="checkbox"
                className="check"
                checked={includeStaples}
                onChange={(e) => setIncludeStaples(e.target.checked)}
              />
              Staples
            </label>
            {done > 0 && (
              <button
                className="btn btn-sm"
                onClick={() => send({ type: "clearTicks" }, () => setTicked(new Set()))}
              >
                Uncheck all
              </button>
            )}
            <button className="btn btn-sm btn-ghost btn-icon" aria-label="Print the list" onClick={() => window.print()}>
              <Icon name="printer" />
            </button>
            {(extras.dishes.length > 0 || extras.items.length > 0) && (
              <button
                className="btn btn-sm btn-ghost btn-danger"
                onClick={() => {
                  if (!window.confirm(`Clear everything added to the ${householdName} list? The plan stays as it is.`)) return;
                  send({ type: "clear" }, () => {
                    setExtras((x) => applyListEdit(x, { type: "clear" }));
                    setTicked(new Set());
                  });
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {!hasAnything ? (
          <div className="empty" style={{ marginTop: 12 }}>
            <strong style={{ fontSize: 17, color: "var(--ink)" }}>The {householdName} list is empty.</strong>
            <p>
              Add a recipe or a meal, type anything you need, or plan the week and it fills itself in.
            </p>
            <div className="actions">
              <a className="btn btn-primary" href="/recipes">
                <Icon name="book" /> Browse recipes
              </a>
              <a className="btn" href="/plan">
                <Icon name="calendar" /> Plan the week
              </a>
            </div>
          </div>
        ) : (
          <div className="panel" style={{ padding: "4px 12px 10px" }}>
            {list.groups.map((group) => {
              const left = group.lines.filter((l) => !l.covered && !ticked.has(l.key)).length;
              return (
                <section
                  key={group.aisle}
                  className="aisle"
                  style={{ ["--aisle" as string]: `var(--aisle-${group.aisle})` }}
                >
                  <div className="aisle-head">
                    <span className="aisle-dot" />
                    <span className="aisle-name">{group.aisle}</span>
                    <span className="aisle-count">{left === 0 ? "done" : `${left} left`}</span>
                  </div>
                  {group.lines.map((line) => {
                    const on = ticked.has(line.key);
                    const from = line.covered
                      ? "In the pantry"
                      : [...line.fromRecipes, line.added ? "added by hand" : null].filter(Boolean).join(" · ");
                    return (
                      <button
                        key={line.key}
                        className="shop-row"
                        role="checkbox"
                        aria-checked={on}
                        disabled={line.covered}
                        onClick={() => toggle(line)}
                      >
                        <span className="tick">
                          <Icon name="check" />
                        </span>
                        <span className="ing-qty">{line.parts.map((p) => p.text).join(" + ") || "—"}</span>
                        <span className="shop-name">
                          {line.name}
                          {from && <span className="shop-from">{from}</span>}
                        </span>
                      </button>
                    );
                  })}
                </section>
              );
            })}
          </div>
        )}

        {list.splitLines.length > 0 && (
          <p className="small muted" style={{ marginTop: 12 }}>
            {list.splitLines.length} ingredient{list.splitLines.length === 1 ? " is" : "s are"} shown in more than one
            unit — no conversion factor exists for them, so they are listed separately rather than guessed.
          </p>
        )}
        {!includeStaples && hasAnything && (
          <p className="small muted" style={{ marginTop: 6 }}>
            Staples like salt and pepper are hidden unless you add them yourself. Tick “Staples” to see them all.
          </p>
        )}
      </section>

      <Toast toast={toast} />
    </div>
  );
}
