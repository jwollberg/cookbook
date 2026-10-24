/**
 * Browser-side calls to the Worker's API. BROWSER ONLY.
 *
 * Every write goes straight to D1 through these, and is live the moment it
 * returns — there is no rebuild between saving and seeing it.
 */

import { LIST_EVENT, countExtras } from "./list";
import type { Ingredient, ListEdit, MealPlan, Recipe, ShoppingExtras } from "./schema";
import { withBase } from "./base";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function send<T>(method: string, path: string, body?: unknown, contentType?: string): Promise<T> {
  const isJson = body !== undefined && contentType === undefined;
  const res = await fetch(withBase(path), {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": contentType ?? "application/json" },
    body: body === undefined ? undefined : isJson ? JSON.stringify(body) : (body as BodyInit),
    // No API route redirects. A redirect means Cloudflare Access's sign-in
    // expired mid-visit and wants to send us to Google, which a fetch can't do.
    redirect: "manual",
  });

  if (res.type === "opaqueredirect" || res.status === 401) {
    // Reloading the page goes through the sign-in and lands back here.
    window.location.reload();
    throw new ApiError("Signed out.", 401);
  }

  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(data?.error ?? `The server said ${res.status}.`, res.status);
  return data as T;
}

export const saveRecipe = (recipe: Recipe, newIngredients: Ingredient[]) =>
  send<{ recipe: Recipe }>("PUT", `/api/recipes/${encodeURIComponent(recipe.id)}`, {
    recipe,
    newIngredients,
  });

export const deleteRecipe = (id: string) =>
  send<{ ok: true }>("DELETE", `/api/recipes/${encodeURIComponent(id)}`);

export const uploadPhoto = (id: string, photo: Blob) =>
  send<{ recipe: Recipe }>("POST", `/api/recipes/${encodeURIComponent(id)}/photo`, photo, photo.type);

/** A recipe draft Claude filled: unsaved, with the new ingredients it needs. */
export type RecipeDraft = { recipe: Recipe; created: Ingredient[] };

export const draftFromLink = (url: string) => send<RecipeDraft>("POST", "/api/drafts/link", { url });

export const draftFromPhoto = (photo: Blob) => send<RecipeDraft>("POST", "/api/drafts/photo", photo, photo.type);

export const removePhoto = (id: string) =>
  send<{ recipe: Recipe }>("DELETE", `/api/recipes/${encodeURIComponent(id)}/photo`);

/** `owner` is whose kitchen the page shows (their user id): the server refuses anyone else's. */
export const savePlan = (owner: string, plan: MealPlan) =>
  send<{ plan: MealPlan }>("PUT", `/api/plans/${encodeURIComponent(plan.id)}`, { owner, plan });

export interface ListState {
  extras: ShoppingExtras;
  ticked: string[];
}

export async function editList(owner: string, edit: ListEdit): Promise<ListState> {
  const state = await send<ListState>("POST", "/api/shopping", { owner, edit });
  announceList(state.extras);
  return state;
}

export const fetchList = (owner: string) =>
  send<ListState>("GET", `/api/shopping?owner=${encodeURIComponent(owner)}`);

/** Tell the nav badge the list changed. */
export function announceList(extras: ShoppingExtras): void {
  window.dispatchEvent(new CustomEvent(LIST_EVENT, { detail: { count: countExtras(extras) } }));
}

/**
 * Shrink a photo in the browser before it is uploaded: phone cameras produce
 * 4000px, 5 MB files, and a recipe page never shows one wider than 1600px.
 */
export async function downsizePhoto(file: File, maxWidth = 1600, quality = 0.84): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not read that photo."))), "image/jpeg", quality),
  );
}
