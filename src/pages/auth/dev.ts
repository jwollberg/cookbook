import type { APIRoute } from "astro";
import { safeNext, writeSession } from "../../lib/server/auth";
import { DEV_USER, sessionSecret } from "../../lib/server/context";
import { ensureHousehold, upsertUser } from "../../lib/server/db";

/**
 * Local development sign-in, so the dev server is usable without Google
 * credentials. `import.meta.env.DEV` is a build-time constant: in the
 * production bundle this handler is the 404 and nothing else.
 */
export const POST: APIRoute = async ({ url, cookies, locals, redirect, request }) => {
  if (!import.meta.env.DEV) return new Response("Not found", { status: 404 });
  const env = locals.runtime.env;
  const viewer = await upsertUser(env.DB, DEV_USER);
  await ensureHousehold(env.DB, viewer);
  await writeSession(cookies, url, sessionSecret(env)!, { uid: viewer.id, email: viewer.email });
  const form = await request.formData();
  return redirect(safeNext(String(form.get("next") ?? "/")));
};
