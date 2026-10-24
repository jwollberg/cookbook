import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import Icon from "./Icon";
import { SLOTS, type Slot } from "../lib/constants";
import type { MealPlan, PlanEntry } from "../lib/schema";
import { addDays, formatDayLabel, formatRange, fromIso, isoDate } from "../lib/dates";
import { emptyPlan, entryCount, sundayOf, planIdFor } from "../lib/plans";
import { savePlan } from "../lib/api";
import { withBase } from "../lib/base";

export interface PlannerRecipe {
  id: string;
  title: string;
  servings: number;
  image?: string;
}

export interface PlannerMeal {
  id: string;
  name: string;
  dishes: number;
  image?: string;
}

interface Props {
  /** Whose week this is (their user id), named on every save. */
  owner: string;
  plans: MealPlan[];
  recipes: PlannerRecipe[];
  meals: PlannerMeal[];
  today: string;
  /** Sunday of the week to open on. */
  sunday: string;
}

type SaveState = "saved" | "saving" | "error";

export default function Planner({ owner, plans, recipes, meals, today, sunday }: Props) {
  const [byId, setById] = useState(() => new Map(plans.map((p) => [p.id, p])));
  const [week, setWeek] = useState(sunday);
  const [plan, setPlan] = useState<MealPlan>(() => byId.get(planIdFor(sunday)) ?? emptyPlan(sunday));
  const [dragging, setDragging] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [filter, setFilter] = useState("");
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const recipesById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const mealsById = useMemo(() => new Map(meals.map((m) => [m.id, m])), [meals]);

  // Autosave, debounced. Plans live in D1 now, so there is no commit to
  // avoid and nothing to lose on a refresh: every change is kept, a moment
  // after the last drag.
  useEffect(() => {
    if (!dirty.current) return;
    setSaveState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const { plan: saved } = await savePlan(owner, plan);
        setById((m) => new Map(m).set(saved.id, saved));
        dirty.current = false;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 600);
    return () => clearTimeout(timer.current);
  }, [plan, owner]);

  // Warn before leaving with a save still in flight.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  const sensors = useSensors(
    // A small distance threshold so a tap on a library card is still a tap.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // On touch, press-and-hold to drag so the library can still be scrolled.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  // --- mutations -----------------------------------------------------------

  const update = (fn: (p: MealPlan) => MealPlan) => {
    dirty.current = true;
    setPlan(fn);
  };

  const addEntry = (date: string, entry: PlanEntry) =>
    update((p) => ({
      ...p,
      days: p.days.map((d) => (d.date === date ? { ...d, entries: [...d.entries, entry] } : d)),
    }));

  const patchEntry = (date: string, index: number, patch: Partial<PlanEntry>) =>
    update((p) => ({
      ...p,
      days: p.days.map((d) =>
        d.date === date ? { ...d, entries: d.entries.map((e, i) => (i === index ? { ...e, ...patch } : e)) } : d,
      ),
    }));

  const removeEntry = (date: string, index: number) =>
    update((p) => ({
      ...p,
      days: p.days.map((d) => (d.date === date ? { ...d, entries: d.entries.filter((_, i) => i !== index) } : d)),
    }));

  // Remove from one day and add to the end of another: the right-click menu's "Move to".
  const moveEntry = (from: string, index: number, to: string) =>
    update((p) => {
      const entry = p.days.find((d) => d.date === from)?.entries[index];
      if (!entry) return p;
      return {
        ...p,
        days: p.days.map((d) =>
          d.date === from
            ? { ...d, entries: d.entries.filter((_, i) => i !== index) }
            : d.date === to
              ? { ...d, entries: [...d.entries, entry] }
              : d,
        ),
      };
    });

  function goTo(nextSunday: string) {
    if (dirty.current) {
      // Flush the pending save for the week being left before moving on.
      clearTimeout(timer.current);
      void savePlan(owner, plan).then(({ plan: saved }) => setById((m) => new Map(m).set(saved.id, saved)));
      setById((m) => new Map(m).set(plan.id, plan));
      dirty.current = false;
      setSaveState("saved");
    }
    setWeek(nextSunday);
    setPlan(byId.get(planIdFor(nextSunday)) ?? emptyPlan(nextSunday));
    const url = new URL(window.location.href);
    url.searchParams.set("week", nextSunday);
    window.history.replaceState(null, "", url);
  }

  const shift = (weeks: number) => goTo(isoDate(addDays(fromIso(week), weeks * 7)));

  const lastWeek = byId.get(planIdFor(isoDate(addDays(fromIso(week), -7))));
  const copyLastWeek = () =>
    lastWeek &&
    update((p) => ({ ...p, days: p.days.map((d, i) => ({ ...d, entries: lastWeek.days[i]?.entries ?? [] })) }));

  function handleDragEnd(event: DragEndEvent) {
    setDragging(null);
    const overId = String(event.over?.id ?? "");
    const activeId = String(event.active?.id ?? "");
    if (!overId.startsWith("day:")) return;
    const date = overId.slice(4);
    const [, kind, id] = activeId.split(":");
    if (kind === "meal") addEntry(date, { slot: "dinner", mealId: id });
    else if (kind === "recipe") addEntry(date, { slot: "dinner", recipeId: id });
  }

  // Keyboard- and tap-friendly alternative to dragging: add to today when
  // it is in this week, otherwise to the Sunday.
  const addTarget = plan.days.some((d) => d.date === today) ? today : plan.days[0].date;

  const dates = plan.days.map((d) => d.date);
  const count = entryCount(plan);
  const q = filter.trim().toLowerCase();
  const shownMeals = meals.filter((m) => !q || m.name.toLowerCase().includes(q));
  const shownRecipes = recipes.filter((r) => !q || r.title.toLowerCase().includes(q));
  const isThisWeek = dates.includes(today);

  const dragLabel = dragging
    ? (() => {
        const [, kind, id] = dragging.split(":");
        return kind === "meal" ? mealsById.get(id)?.name : recipesById.get(id)?.title;
      })()
    : null;

  // Right-click (app-shell/menu.js): a planned dish, a library card, or the week. The same
  // changes as the buttons, the selects and dragging onto a day; refs keep them current.
  const live = useRef({ plan, today, addTarget, isThisWeek, count, lastWeek, addEntry, patchEntry, removeEntry, moveEntry, shift, goTo, copyLastWeek });
  live.current = { plan, today, addTarget, isThisWeek, count, lastWeek, addEntry, patchEntry, removeEntry, moveEntry, shift, goTo, copyLastWeek };
  useEffect(() => {
    const menu = window.atheosMenu;
    if (!menu) return;
    const L = () => live.current;
    const day = (date: string) => `${formatDayLabel(date)}${date === L().today ? " · today" : ""}`;
    const dishHref = (e: PlanEntry) => withBase(e.mealId ? `/meals/${e.mealId}` : `/recipes/${e.recipeId}`);
    const off = [
      menu.add("[data-entry]", (el) => {
        const { plan, patchEntry, removeEntry, moveEntry } = L();
        const date = el.dataset.date!;
        const index = Number(el.dataset.entry);
        const entry = plan.days.find((d) => d.date === date)?.entries[index];
        if (!entry) return null;
        const known = entry.mealId ? mealsById.has(entry.mealId) : recipesById.has(entry.recipeId ?? "");
        return [
          known && { label: entry.mealId ? "Open meal" : "Open recipe", href: dishHref(entry) },
          {
            label: "Move to",
            icon: "calendar",
            items: plan.days.map((d) => ({
              label: day(d.date),
              checked: d.date === date,
              run: () => d.date !== date && moveEntry(date, index, d.date),
            })),
          },
          {
            label: "Slot",
            items: SLOTS.map((s) => ({
              label: s[0].toUpperCase() + s.slice(1),
              checked: entry.slot === s,
              run: () => patchEntry(date, index, { slot: s }),
            })),
          },
          "-",
          { label: "Remove from the day", icon: "trash", danger: true, run: () => removeEntry(date, index) },
        ];
      }),
      menu.add("[data-lib]", (el) => {
        const { plan, today, addTarget, addEntry } = L();
        const [, kind, id] = el.dataset.lib!.split(":");
        const entry: PlanEntry = kind === "meal" ? { slot: "dinner", mealId: id } : { slot: "dinner", recipeId: id };
        return [
          { label: addTarget === today ? "Add to today" : `Add to ${formatDayLabel(addTarget)}`, icon: "plus", run: () => addEntry(addTarget, entry) },
          { label: "Add to", icon: "calendar", items: plan.days.map((d) => ({ label: day(d.date), run: () => addEntry(d.date, entry) })) },
          { label: kind === "meal" ? "Open meal" : "Open recipe", href: dishHref(entry) },
        ];
      }),
      menu.add("[data-planner-bar], .planner-week", (_el, ctx) => {
        if (ctx.target.closest("[data-entry]")) return null;
        const { plan, today, isThisWeek, count, lastWeek, shift, goTo, copyLastWeek } = L();
        return [
          { label: "Previous week", keys: "[", run: () => shift(-1) },
          { label: "Next week", keys: "]", run: () => shift(1) },
          !isThisWeek && { label: "This week", icon: "calendar", keys: "T", run: () => goTo(sundayOf(today)) },
          count === 0 && lastWeek && entryCount(lastWeek) > 0 && { label: "Copy last week", icon: "copy", run: copyLastWeek },
          { label: "Cooking sheet", href: withBase(`/cook?plan=${plan.id}`) },
          { label: "Shopping list", icon: "bag", href: withBase("/shopping") },
        ];
      }),
      menu.key("[", "Previous week", () => L().shift(-1), { group: "Plan" }),
      menu.key("]", "Next week", () => L().shift(1), { group: "Plan" }),
      menu.key("t", "This week", () => L().goTo(sundayOf(L().today)), { group: "Plan", when: () => !L().isThisWeek }),
    ];
    return () => off.forEach((f) => f());
  }, [recipesById, mealsById]);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e: DragStartEvent) => setDragging(String(e.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div
        className="actions"
        data-planner-bar
        style={{ justifyContent: "space-between", marginBottom: 20, rowGap: 14 }}
      >
        <div className="actions" style={{ gap: 6 }}>
          <button className="btn btn-icon btn-sm" onClick={() => shift(-1)} aria-label="Previous week">
            <Icon name="chevronLeft" />
          </button>
          <strong style={{ fontSize: "1.1rem", minWidth: 150, textAlign: "center" }} className="num">
            {formatRange(dates[0], dates[dates.length - 1])}
          </strong>
          <button className="btn btn-icon btn-sm" onClick={() => shift(1)} aria-label="Next week">
            <Icon name="chevronRight" />
          </button>
          {!isThisWeek && (
            <button className="btn btn-sm btn-ghost" onClick={() => goTo(sundayOf(today))}>
              This week
            </button>
          )}
          <span className="savebar" data-state={saveState} role="status" style={{ marginLeft: 6 }}>
            <span className="dot" />
            {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved — check your connection" : "Saved"}
          </span>
        </div>

        <div className="actions" style={{ gap: 8 }}>
          {count === 0 && lastWeek && entryCount(lastWeek) > 0 && (
            <button className="btn btn-sm" onClick={copyLastWeek}>
              Copy last week
            </button>
          )}
          <a className="btn btn-sm" href={withBase(`/cook?plan=${plan.id}`)}>
            <Icon name="pot" /> Cooking sheet
          </a>
          <a className="btn btn-sm btn-primary" href={withBase("/shopping")}>
            <Icon name="bag" /> Shopping list
          </a>
        </div>
      </div>

      <div className="planner">
        <aside className="planner-library panel panel-pad" style={{ display: "grid", gap: 14 }}>
          <strong>Drag onto a day</strong>
          <div className="search">
            <Icon name="search" />
            <input
              className="input input-sm"
              style={{ paddingLeft: 42, minHeight: 40 }}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              aria-label="Filter recipes and meals"
            />
          </div>

          {shownMeals.length > 0 && (
            <div style={{ display: "grid", gap: 6 }}>
              <span className="label">Meals</span>
              {shownMeals.map((m) => (
                <LibraryItem
                  key={m.id}
                  id={`lib:meal:${m.id}`}
                  title={m.name}
                  sub={`${m.dishes} dishes`}
                  image={m.image}
                  onAdd={() => addEntry(addTarget, { slot: "dinner", mealId: m.id })}
                />
              ))}
            </div>
          )}

          <div style={{ display: "grid", gap: 6 }}>
            <span className="label">Recipes</span>
            {shownRecipes.map((r) => (
              <LibraryItem
                key={r.id}
                id={`lib:recipe:${r.id}`}
                title={r.title}
                sub={`Serves ${r.servings}`}
                image={r.image}
                onAdd={() => addEntry(addTarget, { slot: "dinner", recipeId: r.id })}
              />
            ))}
            {shownRecipes.length === 0 && shownMeals.length === 0 && (
              <span className="small muted">Nothing matches “{filter}”.</span>
            )}
          </div>
        </aside>

        <div className="planner-week">
          {plan.days.map((day) => (
            <DayCell
              key={day.date}
              date={day.date}
              today={day.date === today}
              entries={day.entries}
              recipesById={recipesById}
              mealsById={mealsById}
              onPatch={(i, patch) => patchEntry(day.date, i, patch)}
              onRemove={(i) => removeEntry(day.date, i)}
            />
          ))}
        </div>
      </div>

      <DragOverlay>
        {dragLabel && (
          <div className="lib-item" style={{ boxShadow: "var(--shadow-lg)", background: "var(--surface)", fontWeight: 600 }}>
            {dragLabel}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ---------------------------------------------------------------------------

function Thumb({ image }: { image?: string }) {
  return image ? <img src={withBase(image)} alt="" loading="lazy" /> : <span className="thumb-empty" />;
}

function LibraryItem({
  id,
  title,
  sub,
  image,
  onAdd,
}: {
  id: string;
  title: string;
  sub: string;
  image?: string;
  onAdd: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });

  return (
    <div ref={setNodeRef} className="lib-item" data-lib={id} style={{ opacity: isDragging ? 0.4 : 1 }}>
      {/*
        Listeners go on an inner handle rather than the measured node. dnd-kit's
        attributes include role="button", and the add button below would then be
        a button nested inside a button — invalid, and a keyboard trap.
      */}
      <div
        {...listeners}
        {...attributes}
        style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, cursor: "grab", touchAction: "manipulation" }}
      >
        <Thumb image={image} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{title}</span>
          <span className="small muted">{sub}</span>
        </span>
      </div>
      <button className="btn btn-ghost btn-icon btn-sm" onClick={onAdd} aria-label={`Add ${title} to the plan`}>
        <Icon name="plus" />
      </button>
    </div>
  );
}

function DayCell({
  date,
  today,
  entries,
  recipesById,
  mealsById,
  onPatch,
  onRemove,
}: {
  date: string;
  today: boolean;
  entries: PlanEntry[];
  recipesById: Map<string, PlannerRecipe>;
  mealsById: Map<string, PlannerMeal>;
  onPatch: (index: number, patch: Partial<PlanEntry>) => void;
  onRemove: (index: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}` });
  const className = ["day", today ? "is-today" : "", isOver ? "is-over" : ""].filter(Boolean).join(" ");

  return (
    <div ref={setNodeRef} className={className}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 14, color: today ? "var(--accent)" : "var(--ink)" }}>{formatDayLabel(date)}</strong>
        {today && <span className="chip chip-accent" style={{ minHeight: 24 }}>Today</span>}
      </div>

      {entries.length === 0 ? (
        <p className="small muted">Drop a dish here.</p>
      ) : (
        entries.map((entry, i) => {
          const meal = entry.mealId ? mealsById.get(entry.mealId) : undefined;
          const recipe = entry.recipeId ? recipesById.get(entry.recipeId) : undefined;
          const label = meal?.name ?? recipe?.title ?? `Missing: ${entry.mealId ?? entry.recipeId}`;
          return (
            <div key={i} className="entry" data-date={date} data-entry={i}>
              <Thumb image={meal?.image ?? recipe?.image} />
              <span className="entry-title">{label}</span>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => onRemove(i)} aria-label={`Remove ${label}`}>
                <Icon name="x" />
              </button>
              <div className="entry-controls">
                <select
                  className="select select-sm"
                  value={entry.slot}
                  onChange={(e) => onPatch(i, { slot: e.target.value as Slot })}
                  aria-label="Meal slot"
                >
                  {SLOTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <input
                  className="input input-sm num"
                  type="number"
                  min={1}
                  value={entry.servings ?? ""}
                  placeholder={String(recipe?.servings ?? "—")}
                  onChange={(e) => onPatch(i, { servings: e.target.value ? Number(e.target.value) : undefined })}
                  aria-label="Servings"
                  title="Servings"
                />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
