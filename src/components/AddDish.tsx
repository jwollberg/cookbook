import Icon from "./Icon";
import { Toast, useList } from "./useList";
import type { ShoppingExtras } from "../lib/schema";

/** "Add to shopping list" for a whole meal — every dish in it, at its own servings. */
export default function AddDish({
  mealId,
  title,
  householdId,
  householdName,
  extras,
}: {
  mealId: string;
  title: string;
  householdId: string;
  householdName: string;
  extras: ShoppingExtras;
}) {
  const list = useList(householdId, extras);
  const onList = Boolean(list.has({ mealId }));

  return (
    <div className="actions">
      {onList ? (
        <>
          <a className="btn" href="/shopping">
            <Icon name="check" /> On the {householdName} list
          </a>
          <button className="btn btn-ghost btn-sm" disabled={list.busy} onClick={() => list.remove({ mealId }, title)}>
            Remove
          </button>
        </>
      ) : (
        <button className="btn btn-primary" disabled={list.busy} onClick={() => list.add({ mealId }, title)}>
          <Icon name="bag" /> Add the whole meal to the list
        </button>
      )}
      <Toast toast={list.toast} />
    </div>
  );
}
