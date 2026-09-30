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
import { emptyPlan, entryCount, mondayOf, planIdFor } from "../lib/plans";
import { savePlan } from "../lib/api";

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
  householdId: string;
  householdName: string;
  plans: MealPlan[];
  recipes: PlannerRecipe[];
  meals: PlannerMeal[];
  today: string;
  /** Monday of the week to open on. */
  monday: string;
}

type SaveState = "saved" | "saving" | "error";

export default function Planner({ householdId, householdName, plans, recipes, meals, today, monday }: Props) {
  const [byId, setById] = useState(() => new Map(plans.map((p) => [p.id, p])));
  const [week, setWeek] = useState(monday);
  const [plan, setPlan] = useState<MealPlan>(() => byId.get(planIdFor(monday)) ?? emptyPlan(monday));
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
        const { plan: saved } = await savePlan(householdId, plan);
        setById((m) => new Map(m).set(saved.id, saved));
        dirty.current = false;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 600);
    return () => clearTimeout(timer.current);
  }, [plan, householdId]);

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

  function goTo(nextMonday: string) {
    if (dirty.current) {
      // Flush the pending save for the week being left before moving on.
      clearTimeout(timer.current);
      void savePlan(householdId, plan).then(({ plan: saved }) => setById((m) => new Map(m).set(saved.id, saved)));
      setById((m) => new Map(m).set(plan.id, plan));
      dirty.current = false;
      setSaveState("saved");
    }
    setWeek(nextMonday);
    setPlan(byId.get(planIdFor(nextMonday)) ?? emptyPlan(nextMonday));
    const url = new URL(window.location.href);
    url.searchParams.set("week", nextMonday);
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
  // it is in this week, otherwise to the Monday.
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

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e: DragStartEvent) => setDragging(String(e.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div
        className="actions"
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
            <button className="btn btn-sm btn-ghost" onClick={() => goTo(mondayOf(today))}>
              This week
            </button>
          )}
          <span className="savebar" data-state={saveState} role="status" style={{ marginLeft: 6 }}>
            <span className="dot" />
            {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved — check your connection" : `Saved to ${householdName}`}
          </span>
        </div>

        <div className="actions" style={{ gap: 8 }}>
          {count === 0 && lastWeek && entryCount(lastWeek) > 0 && (
            <button className="btn btn-sm" onClick={copyLastWeek}>
              Copy last week
            </button>
          )}
          <a className="btn btn-sm" href={`/cook?plan=${plan.id}`}>
            <Icon name="pot" /> Cooking sheet
          </a>
          <a className="btn btn-sm btn-primary" href="/shopping">
            <Icon name="bag" /> Shopping list
          </a>
        </div>
      </div>

      <div className="planner">
        <aside className="planner-library panel panel-pad" style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <strong>Drag onto a day</strong>
            <span className="small muted">Or tap + to add to {addTarget === today ? "today" : "Monday"}.</span>
          </div>
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
  return image ? <img src={image} alt="" loading="lazy" /> : <span className="thumb-empty" />;
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
    <div ref={setNodeRef} className="lib-item" style={{ opacity: isDragging ? 0.4 : 1 }}>
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
            <div key={i} className="entry">
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
                  title="Servings — blank uses the recipe's own"
                />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
