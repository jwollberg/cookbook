import Icon from "./Icon";
import { Toast, useList } from "./useList";
import type { ShoppingExtras } from "../lib/schema";
import { withBase } from "../lib/base";

/** "Add to shopping list" for a whole meal — every dish in it, at its own servings. */
export default function AddDish({
  mealId,
  title,
  owner,
  extras,
}: {
  mealId: string;
  title: string;
  owner: string;
  extras: ShoppingExtras;
}) {
  const list = useList(owner, extras);
  const onList = Boolean(list.has({ mealId }));

  return (
    <div className="actions">
      {onList ? (
        <>
          <a className="btn" href={withBase("/shopping")}>
            <Icon name="check" /> On your list
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
