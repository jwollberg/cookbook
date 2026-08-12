import type { APIRoute } from "astro";
import { loadAll } from "../../lib/data.server";

/**
 * Build-time aggregate of everything under public/data.
 *
 * A static host cannot list a directory, so the client has no way to discover
 * which recipe files exist. This emits one bundle at build time instead of
 * making the browser guess or fetch N files.
 *
 * Generated from the same loader the pages use, so it can never drift from
 * the individual files — those remain the source of truth that the editor
 * writes to.
 */
export const GET: APIRoute = () => {
  const { ingredients, recipes, meals, plans, pantry } = loadAll();

  return new Response(JSON.stringify({ ingredients, recipes, meals, plans, pantry }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Short cache: after an edit is committed the rebuild replaces this,
      // and a stale copy would make a fresh save look like it vanished.
      "Cache-Control": "public, max-age=60",
    },
  });
};
