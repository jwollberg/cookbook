/**
 * The folder this build is served from: "" on its own hostname, "/hestia" under
 * oikos.atheosstudios.com (`BASE_PATH` at build time, astro.config.mjs). Used on both sides.
 *
 * The app's own links, API calls and photos are written as root paths ("/recipes",
 * "/photos/…", as the database stores them); `withBase` turns one into the address the
 * browser must ask for, and `routePath` turns a request's path back into the route's.
 */
export const BASE = import.meta.env.BASE_URL.replace(/\/+$/, "");

/** A root path of this app, under the folder it's served from. Other addresses pass through. */
export function withBase(path: string): string;
export function withBase(path: string | undefined): string | undefined;
export function withBase(path: string | undefined): string | undefined {
  if (!path || !BASE || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/cdn-cgi/")) return path;
  return BASE + path;
}

/** A request's path as the routes know it, without the folder ("/hestia/recipes" → "/recipes"). */
export const routePath = (pathname: string) =>
  BASE && (pathname === BASE || pathname.startsWith(`${BASE}/`)) ? pathname.slice(BASE.length) || "/" : pathname;
