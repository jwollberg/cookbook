import { useCallback, useEffect, useRef, useState } from "react";
import { editList } from "../lib/api";
import { findDish, type DishRef } from "../lib/list";
import type { ListDish, ListEdit, ShoppingExtras } from "../lib/schema";

export interface ToastMessage {
  text: string;
  link?: { href: string; label: string };
}

/**
 * The household's list, as seen by an island that adds to it (a recipe
 * card, a recipe or meal page). Each edit is sent to the server, which
 * applies it to the latest copy; the response replaces the local state.
 */
export function useList(householdId: string, initial: ShoppingExtras) {
  const [extras, setExtras] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((message: ToastMessage) => {
    setToast(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3600);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const run = useCallback(
    async (edit: ListEdit, success?: ToastMessage) => {
      setBusy(true);
      try {
        const state = await editList(householdId, edit);
        setExtras(state.extras);
        if (success) show(success);
        return true;
      } catch (error) {
        show({ text: error instanceof Error ? error.message : "Could not update the list." });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [householdId, show],
  );

  const toList = { href: "/shopping", label: "View list" };

  const add = (dish: ListDish, title: string) =>
    run({ type: "addDish", dish }, { text: `${title} is on the list`, link: toList });

  const remove = (ref: DishRef, title: string) =>
    run({ type: "removeDish", ref }, { text: `${title} removed from the list` });

  return { extras, busy, toast, add, remove, has: (ref: DishRef) => findDish(extras, ref) };
}

export function Toast({ toast }: { toast: ToastMessage | null }) {
  if (!toast) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      <span>{toast.text}</span>
      {toast.link && (
        <a className="btn btn-sm" style={{ color: "var(--ink)" }} href={toast.link.href}>
          {toast.link.label}
        </a>
      )}
    </div>
  );
}
