/**
 * The sign-in gate. Every page and API route passes through here.
 *
 * Static files (JS, CSS, the starter photos) are served by Cloudflare before
 * the Worker runs and never reach this — which is exactly why nothing private
 * is ever a static file.
 */

import { defineMiddleware } from "astro:middleware";
import { isAllowed, readSession } from "./lib/server/auth";
import { isDevViewer, sessionSecret } from "./lib/server/context";
import { ensureHousehold, loadViewer } from "./lib/server/db";

/** Reachable while signed out: the sign-in flow itself, and robots.txt. */
const PUBLIC = [/^\/login\/?$/, /^\/auth\//, /^\/robots\.txt$/];

const isApi = (path: string) => path.startsWith("/api/") || path.startsWith("/photos/");

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, request, locals, cookies } = context;
  if (PUBLIC.some((re) => re.test(url.pathname))) return next();

  const env = locals.runtime.env;
  const session = await readSession(cookies, url, sessionSecret(env));
  const viewer = session ? await loadViewer(env.DB, session.uid) : null;

  // The allowlist is checked on every request, not only at sign-in, so taking
  // someone off it locks them out immediately rather than in thirty days.
  const allowed = viewer && (isDevViewer(viewer) || isAllowed(viewer.email, env.ALLOWED_EMAILS));
  if (!viewer || !allowed) {
    if (isApi(url.pathname)) {
      return new Response(JSON.stringify({ error: "Your session has ended — sign in again." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return context.redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }

  // Writes must come from our own pages. SameSite=Lax already keeps the
  // cookie off cross-site POSTs; this is the second lock on the same door.
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("Origin");
    if (origin !== url.origin) {
      return new Response(JSON.stringify({ error: "Cross-site request refused." }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  locals.viewer = viewer;
  locals.household = await ensureHousehold(env.DB, viewer);

  const response = await next();
  // Every page here is personal. Never let a shared cache keep one.
  if (!response.headers.has("Cache-Control")) {
    try {
      response.headers.set("Cache-Control", "private, no-store");
    } catch {
      /* immutable headers (a redirect) — nothing worth caching anyway */
    }
  }
  return response;
});
