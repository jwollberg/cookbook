/**
 * The gate. Every page and API route passes through here.
 *
 * In production Cloudflare Access stands in front of the whole hostname and
 * does the Google sign-in (the same login as every other Atheos app). It signs
 * each request it lets through; we check that signature again here and the
 * email against ALLOWED_EMAILS, so a mistake in the Access policy still lets
 * nobody in. The dev server (import.meta.env.DEV, compiled out of a build)
 * signs you in as the local Dev Cook instead.
 *
 * Static files (JS, CSS, the starter photos) are served by Cloudflare before
 * the Worker runs and never reach this — which is exactly why nothing private
 * is ever a static file.
 */

import { defineMiddleware } from "astro:middleware";
import { accessToken, verifyAccessJwt } from "./lib/server/access";
import { isAllowed } from "./lib/server/auth";
import { DEV_USER } from "./lib/server/context";
import { ensureHousehold, loadViewer, upsertUser, userForEmail } from "./lib/server/db";

const PUBLIC = [/^\/robots\.txt$/];
/** The old sign-in pages. Access signs people in now; send old bookmarks home. */
const RETIRED = [/^\/login\/?$/, /^\/auth\//];

const isApi = (path: string) => path.startsWith("/api/") || path.startsWith("/photos/");

function refuse(path: string, message: string): Response {
  if (isApi(path)) {
    return new Response(JSON.stringify({ error: message }), {
      status: 403,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not allowed</title>
<body style="font:16px/1.5 system-ui;max-width:32rem;margin:15vh auto;padding:0 20px;color:#1c1917">
<h1 style="font-size:22px">Kitchen is private</h1><p>${message}</p>
<p><a href="/cdn-cgi/access/logout">Sign in with a different account</a></p></body>`,
    { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, request, locals } = context;
  if (PUBLIC.some((re) => re.test(url.pathname))) return next();
  if (RETIRED.some((re) => re.test(url.pathname))) return context.redirect("/");

  const env = locals.runtime.env;
  let viewer;
  if (import.meta.env.DEV) {
    viewer = (await loadViewer(env.DB, DEV_USER.id)) ?? (await upsertUser(env.DB, DEV_USER));
    locals.owner = true;
  } else {
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ALLOWED_EMAILS) {
      return refuse(url.pathname, "The login isn't set up yet, so nobody can get in.");
    }
    // The allowlist is checked on every request, so taking someone off it
    // locks them out immediately.
    const claims = await verifyAccessJwt(accessToken(request), env);
    if (!claims || !isAllowed(claims.email, env.ALLOWED_EMAILS)) {
      return refuse(url.pathname, "This account isn't on the list. Ask Josh to add you.");
    }
    viewer = await userForEmail(env.DB, claims.email);
    locals.owner = isAllowed(claims.email, env.OWNER_EMAILS);
  }

  // Writes must come from our own pages. SameSite cookies already keep Access's
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
