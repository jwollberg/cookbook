/**
 * Home's People page, removing someone (POST { email }): forget them here — their week plans,
 * shopping list, ticks and pantry, and their users row (`forgetPerson` in db.ts). The recipes,
 * meals and ingredients they wrote stay in the shared library. The middleware lets /internal/
 * through only with INTERNAL_TOKEN, and the tunnel never routes it. It does not ask the People
 * list: by the time Home calls this, the person is usually off it.
 */

import type { APIRoute } from "astro";
import { forgetPerson } from "../../lib/server/db";
import { fail, json } from "../../lib/server/http";

export const POST: APIRoute = async ({ request, locals }) => {
  const input = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof input?.email === "string" ? input.email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return fail(400, "Expected { email }.");
  const removed = await forgetPerson(locals.runtime.env.DB, email);
  return json({ ok: true, removed });
};
