/**
 * Every app shares oikos.atheosstudios.com (plan-one-address-one-app), so the browser no longer
 * walls one app's pages off from another's: a script running in any of them could call the others
 * with your login. Two things stand in its way, on every app (step 15):
 *
 * - **A strict Content-Security-Policy** on every answer (`contentSecurityPolicy`): scripts run
 *   only from the address's own files, plus the few inline ones the app names (theme.js, menu.js)
 *   and Astro's island loaders, each by its hash. A script slipped into a page (a recipe's text, a
 *   note) doesn't run, and neither does an inline event handler (onclick=) or a javascript: link.
 *   Styles may be inline (style= attributes and <style> can't run code); fonts come from Google.
 *   An app adds only the outside addresses it really uses (`Extras`: Argos's map tiles, Plaid).
 *   Astro's own small processed scripts are kept as files (`vite.build.assetsInlineLimit: 0` in
 *   astro.config.mjs), so they need no hash.
 * - **A write must come from one of the app's own pages** (`fromOwnPage`): same origin, and on the
 *   shared address a Referer inside its own folder (Oikos: outside every app's folder). A link,
 *   form or fetch in another app's page is refused. A script on the address could still forge the
 *   Referer, as it could read the app's pages: the policy is what keeps scripts that aren't ours
 *   from running at all.
 *
 * Canonical copy: Oikos's `vault/app-platform/security.ts` (app-shell/README.md, Served from a
 * folder). Each Astro app carries a copy (src/lib/server/security.ts; Oikos's src/lib/security.ts)
 * and calls both from its middleware; Echo, in Python, does the same in its own server.
 */

import { createHash } from "node:crypto";
import idle from "astro/runtime/client/idle.prebuilt.js";
import load from "astro/runtime/client/load.prebuilt.js";
import media from "astro/runtime/client/media.prebuilt.js";
import only from "astro/runtime/client/only.prebuilt.js";
import visible from "astro/runtime/client/visible.prebuilt.js";
import island from "astro/runtime/server/astro-island.prebuilt.js";
import islandDev from "astro/runtime/server/astro-island.prebuilt-dev.js";

/**
 * A script's CSP hash source: the text between its <script> and </script>, with its line endings
 * as the browser hashes them (its HTML parser turns CRLF and lone CR into LF; a Windows checkout
 * without eol=lf has CRLF).
 */
export const scriptHash = (code: string) =>
  `'sha256-${createHash("sha256").update(code.replace(/\r\n?/g, "\n"), "utf8").digest("base64")}'`;

/** The inline scripts Astro writes into a page with a React island (its loader and the client: directives). */
export const ASTRO_INLINE = [island, islandDev, idle, load, media, only, visible];

/** Outside addresses an app's pages use, by directive (e.g. `{ img: ["https://tile.openstreetmap.org"] }`). */
export interface Extras {
  script?: string[];
  style?: string[];
  font?: string[];
  img?: string[];
  media?: string[];
  connect?: string[];
  frame?: string[];
  worker?: string[];
}

/** The policy for every answer of an app, given the inline scripts its pages carry (their exact text). */
export function contentSecurityPolicy(inline: string[], extras: Extras = {}): string {
  const hashes = [...new Set([...ASTRO_INLINE, ...inline].map(scriptHash))];
  const d = (name: string, base: string[], more: string[] = []) => `${name} ${[...new Set([...base, ...more])].join(" ")}`;
  return [
    "default-src 'self'",
    d("script-src", ["'self'", ...hashes], extras.script),
    "script-src-attr 'none'",
    d("style-src", ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"], extras.style),
    d("font-src", ["'self'", "data:", "https://fonts.gstatic.com"], extras.font),
    d("img-src", ["'self'", "data:", "blob:"], extras.img),
    d("media-src", ["'self'", "blob:"], extras.media),
    d("connect-src", ["'self'"], extras.connect),
    extras.frame?.length ? d("frame-src", extras.frame) : "frame-src 'none'",
    d("worker-src", ["'self'"], extras.worker),
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Whether a request changes something (the methods `fromOwnPage` guards). */
export const isWrite = (method: string) => WRITES.has(method.toUpperCase());

const under = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);

/**
 * Whether a write comes from one of this app's own pages. `base` is the folder this build is
 * served from ("" on its own hostname, lib/base.ts's BASE); `foreign` the other apps' folders,
 * for Oikos at the root of the shared address. Its pages' Referrer-Policy (same-origin) sends the
 * Referer on every request they make. Machine doors (/internal/, /mcp, Argos's /pub, a webhook)
 * are checked by their own keys instead, never by this.
 */
export function fromOwnPage(request: Request, base: string, foreign: string[] = []): boolean {
  const self = new URL(request.url).origin;
  if (request.headers.get("Origin") !== self) return false;
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return false;
  if (!base && !foreign.length) return true;
  let from: URL;
  try {
    from = new URL(request.headers.get("Referer") ?? "");
  } catch {
    return false;
  }
  if (from.origin !== self) return false;
  return base ? under(from.pathname, base) : !foreign.some((f) => under(from.pathname, f));
}

/** The answer to a write from somewhere else. */
export const crossSite = () =>
  new Response(JSON.stringify({ error: "Cross-site request refused." }), {
    status: 403,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
