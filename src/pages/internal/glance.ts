/**
 * Home's Kitchen tile, asked by the Home container on Vault (POST { email, today }): the
 * household's meals tonight, planned days and shopping-list count. The middleware lets
 * /internal/ through only with INTERNAL_TOKEN, and the tunnel never routes it; it still
 * answers only for people on ALLOWED_EMAILS.
 */

import type { APIRoute } from "astro";
import { isAllowed } from "../../lib/server/auth";
import { kitchenGlance } from "../../lib/server/glance";

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const POST: APIRoute = async ({ request, locals }) => {
  const input = (await request.json().catch(() => null)) as { email?: string; today?: string } | null;
  const env = locals.runtime.env;
  const glance =
    input && isAllowed(input.email, env.ALLOWED_EMAILS) && isDay(input.today) ? await kitchenGlance(env, input.email!, input.today) : null;
  return Response.json(glance, { headers: { "Cache-Control": "no-store" } });
};
