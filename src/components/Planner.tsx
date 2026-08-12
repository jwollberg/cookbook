import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SLOTS, type MealPlan, type PlanEntry, type Slot } from "../lib/schema";
import {
  addDays,
  formatDayLabel,
  formatRange,
  fromIso,
  isoDate,
  startOfWeek,
  weekDates,
} from "../lib/dates";
import {
  getDraftPlan,
  getToken,
  loadCookbook,
  savePlan,
  setDraftPlan,
  type Cookbook,
} from "../lib/store";

const newPlan = (start: Date): MealPlan => ({
  id: `week-${isoDate(start)}`,
  name: `Week of ${formatDayLabel(isoDate(start))}`,
  days: weekDates(start).map((date) => ({ date, entries: [] })),
});

export default function Planner() {
  const [cookbook, setCookbook] = useState<Cookbook | null>(null);
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; url?: string }>();
  const [hasToken, setHasToken] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    setHasToken(Boolean(getToken()));
    void (async () => {
      const { data } = await loadCookbook();
      setCookbook(data);
      setPlan(getDraftPlan() ?? newPlan(startOfWeek(new Date())));
      loaded.current = true;
    })();
  }, []);

  // Persist every change so the cooking sheet and shopping list see it, and so
  // a refresh mid-week does not lose the plan.
  useEffect(() => {
    if (loaded.current && plan) setDraftPlan(plan);
  }, [plan]);

  const sensors = useSensors(
    // A small distance threshold so a click on a library card still behaves
    // like a click rather than starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const recipesById = useMemo(
    () => new Map(cookbook?.recipes.map((r) => [r.id, r]) ?? []),
    [cookbook],
  );
  const mealsById = useMemo(() => new Map(cookbook?.meals.map((m) => [m.id, m]) ?? []), [cookbook]);

  if (!cookbook || !plan) return <p style={{ color: "var(--muted)" }}>Loading…</p>;

  const dates = plan.days.map((d) => d.date);
  const entryCount = plan.days.reduce((n, d) => n + d.entries.length, 0);

  // --- mutations -----------------------------------------------------------

  const addEntry = (date: string, entry: PlanEntry) =>
    setPlan((p) =>
      p
        ? {
            ...p,
            days: p.days.map((d) => (d.date === date ? { ...d, entries: [...d.entries, entry] } : d)),
          }
        : p,
    );

  const patchEntry = (date: string, index: number, patch: Partial<PlanEntry>) =>
    setPlan((p) =>
      p
        ? {
            ...p,
            days: p.days.map((d) =>
              d.date === date
                ? { ...d, entries: d.entries.map((e, i) => (i === index ? { ...e, ...patch } : e)) }
                : d,
            ),
          }
        : p,
    );

  const removeEntry = (date: string, index: number) =>
    setPlan((p) =>
      p
        ? {
            ...p,
            days: p.days.map((d) =>
              d.date === date ? { ...d, entries: d.entries.filter((_, i) => i !== index) } : d,
            ),
          }
        : p,
    );

  function shiftWeek(delta: number) {
    const start = addDays(fromIso(dates[0]), delta * 7);
    const next = newPlan(start);
    // Carry entries across by weekday position, so nudging the week forward
    // keeps the plan you built rather than wiping it.
    next.days = next.days.map((d, i) => ({ ...d, entries: plan!.days[i]?.entries ?? [] }));
    setPlan(next);
  }

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

  async function onSave() {
    setSaving(true);
    setResult(undefined);
    const res = await savePlan(plan!);
    setSaving(false);
    setResult(
      res.committed
        ? { ok: true, text: "Plan committed.", url: res.url }
        : { ok: false, text: res.error ?? "Could not commit." },
    );
  }

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
      {/* --- toolbar --- */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-sm" onClick={() => shiftWeek(-1)} aria-label="Previous week">
            ←
          </button>
          <strong style={{ fontFamily: "var(--display)", fontSize: "1.15rem" }}>
            {formatRange(dates[0], dates[dates.length - 1])}
          </strong>
          <button className="btn btn-sm" onClick={() => shiftWeek(1)} aria-label="Next week">
            →
          </button>
          <span className="chip num">
            {entryCount} {entryCount === 1 ? "entry" : "entries"}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="btn btn-sm" href="/cook">Cooking sheet</a>
          <a className="btn btn-sm" href="/shopping">Shopping list</a>
          <button className="btn btn-sm btn-primary" onClick={onSave} disabled={saving || entryCount === 0}>
            {saving ? "Saving…" : "Save plan"}
          </button>
        </div>
      </div>

      {result && (
        <p
          role="status"
          style={{ margin: "0 0 16px", fontSize: 13, color: result.ok ? "var(--olive)" : "var(--accent)" }}
        >
          {result.text}{" "}
          {result.url && (
            <a href={result.url} target="_blank" rel="noopener noreferrer">View commit →</a>
          )}
        </p>
      )}

      {!hasToken && entryCount > 0 && (
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--muted)" }}>
          Kept in this browser. Connect a token on the <a href="/edit">edit hub</a> to commit it to
          the repo.
        </p>
      )}

      <div className="planner-layout">
        {/* --- library --- */}
        <aside className="planner-library">
          <span className="lbl">Drag onto a day</span>

          {cookbook.meals.length > 0 && (
            <>
              <p className="lbl" style={{ marginTop: 14, color: "var(--ink-2)" }}>Meals</p>
              <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                {cookbook.meals.map((m) => (
                  <LibraryCard
                    key={m.id}
                    id={`lib:meal:${m.id}`}
                    title={m.name}
                    sub={`${m.components.length} recipes`}
                    accent
                    onAdd={() => addEntry(dates[0], { slot: "dinner", mealId: m.id })}
                  />
                ))}
              </div>
            </>
          )}

          <p className="lbl" style={{ marginTop: 18, color: "var(--ink-2)" }}>Recipes</p>
          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            {cookbook.recipes.map((r) => (
              <LibraryCard
                key={r.id}
                id={`lib:recipe:${r.id}`}
                title={r.title}
                sub={`Serves ${r.servings}`}
                onAdd={() => addEntry(dates[0], { slot: "dinner", recipeId: r.id })}
              />
            ))}
          </div>
        </aside>

        {/* --- week --- */}
        <div className="planner-week">
          {plan.days.map((day) => (
            <DayCell
              key={day.date}
              date={day.date}
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
          <div className="card" style={{ padding: "8px 12px", fontSize: 14, boxShadow: "var(--shadow-lg)" }}>
            {dragLabel}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ---------------------------------------------------------------------------

function LibraryCard({
  id,
  title,
  sub,
  accent = false,
  onAdd,
}: {
  id: string;
  title: string;
  sub: string;
  accent?: boolean;
  onAdd: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });

  return (
    <div
      ref={setNodeRef}
      className="card-soft"
      style={{
        padding: "8px 10px",
        borderRadius: "var(--radius-sm)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        opacity: isDragging ? 0.4 : 1,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        borderLeft: `3px solid ${accent ? "var(--accent)" : "var(--hairline-strong)"}`,
      }}
    >
      {/*
        Listeners go on an inner handle rather than the measured node. dnd-kit's
        attributes include role="button", and the add button below would then be
        a button nested inside a button — invalid, and a keyboard trap.
      */}
      <div
        {...listeners}
        {...attributes}
        style={{ flex: 1, minWidth: 0, cursor: "grab", touchAction: "none" }}
      >
        <span style={{ display: "block", fontSize: 14, fontWeight: 500 }}>{title}</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{sub}</span>
      </div>
      {/* Dragging is not reachable by keyboard here, so every card also has a
          plain button that adds to the first day. */}
      <button
        className="btn btn-ghost btn-sm"
        style={{ minHeight: 26, padding: "0 8px", flex: "none" }}
        onClick={onAdd}
        aria-label={`Add ${title} to the first day`}
      >
        +
      </button>
    </div>
  );
}

function DayCell({
  date,
  entries,
  recipesById,
  mealsById,
  onPatch,
  onRemove,
}: {
  date: string;
  entries: PlanEntry[];
  recipesById: Map<string, { title: string; servings: number }>;
  mealsById: Map<string, { name: string; components: unknown[] }>;
  onPatch: (index: number, patch: Partial<PlanEntry>) => void;
  onRemove: (index: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}` });
  const today = date === isoDate(new Date());

  return (
    <div
      ref={setNodeRef}
      className="card"
      style={{
        padding: "12px 14px 14px",
        minHeight: 118,
        borderColor: isOver ? "var(--accent)" : today ? "var(--hairline-strong)" : "var(--hairline)",
        background: isOver ? "var(--accent-wash)" : "var(--surface)",
        transition: "background 0.12s, border-color 0.12s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="lbl" style={{ color: today ? "var(--accent)" : "var(--muted)" }}>
          {formatDayLabel(date)}
        </span>
        {today && <span className="chip chip-accent">Today</span>}
      </div>

      {entries.length === 0 ? (
        <p style={{ margin: "14px 0 0", fontSize: 13, color: "var(--muted)" }}>Drop a meal here.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 8 }}>
          {entries.map((entry, i) => {
            const meal = entry.mealId ? mealsById.get(entry.mealId) : undefined;
            const recipe = entry.recipeId ? recipesById.get(entry.recipeId) : undefined;
            const label = meal?.name ?? recipe?.title ?? "Unknown";
            const missing = !meal && !recipe;

            return (
              <li
                key={i}
                className="card-soft"
                style={{
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  borderLeft: `3px solid ${meal ? "var(--accent)" : "var(--olive)"}`,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "start" }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>
                    {missing ? `⚠ ${entry.mealId ?? entry.recipeId}` : label}
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ minHeight: 22, padding: "0 5px" }}
                    onClick={() => onRemove(i)}
                    aria-label={`Remove ${label}`}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                  <select
                    className="select"
                    style={{ minHeight: 28, padding: "2px 6px", fontSize: 12, width: "auto" }}
                    value={entry.slot}
                    onChange={(e) => onPatch(i, { slot: e.target.value as Slot })}
                    aria-label="Meal slot"
                  >
                    {SLOTS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <input
                    className="input num"
                    style={{ minHeight: 28, padding: "2px 6px", fontSize: 12, width: 62 }}
                    type="number"
                    min={1}
                    value={entry.servings ?? ""}
                    placeholder={String(recipe?.servings ?? "—")}
                    onChange={(e) =>
                      onPatch(i, { servings: e.target.value ? Number(e.target.value) : undefined })
                    }
                    aria-label="Servings"
                    title="Servings — blank uses the recipe default"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
