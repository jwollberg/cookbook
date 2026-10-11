/**
 * Home's Kitchen tile, asked by the Home container on Vault (POST { email, today }): that
 * person's own kitchen — its name, tonight's dishes, planned days and shopping-list count,
 * never anyone else's. The middleware lets /internal/ through only with INTERNAL_TOKEN, and
 * the tunnel never routes it; it still answers only for people Home's People list lets use
 * Kitchen.
 */

import type { APIRoute } from "astro";
import { kitchenGlance } from "../../lib/server/glance";
import { accessFor } from "../../lib/server/people";

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const POST: APIRoute = async ({ request, locals }) => {
  const input = (await request.json().catch(() => null)) as { email?: string; today?: string } | null;
  const env = locals.runtime.env;
  const glance =
    input && isDay(input.today) && (await accessFor(input.email, "kitchen", env)).allowed
      ? await kitchenGlance(env, input.email!, input.today)
      : null;
  return Response.json(glance, { headers: { "Cache-Control": "no-store" } });
};
