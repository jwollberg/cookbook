/**
 * The app list (Home's app-shell/apps.json): every app's name, address, colors and icon, for the
 * app switcher, and each app's Home Screen icon. Home is the one list, as it is for people. An
 * app asks it (GET http://atheos-home:8080/internal/apps, with INTERNAL_TOKEN) at most once a
 * minute, keeps the last good answer while Home is away, and uses its own copy of apps.json
 * (passed in as `fallback`) until Home first answers, or always without INTERNAL_TOKEN (a dev
 * server). Its icons come from Home too (`homeIcon`), drawn from the same list, so changing an
 * app's icon or color in Home's apps.json reaches every app when Home deploys.
 *
 * Canonical copy: Website-Home `vault/app-platform/apps.ts`; each app carries a copy at
 * src/lib/server/apps.ts (Home's `vault/README.md`, The apps' platform).
 */

export interface Palette {
  app: string;
  hover: string;
  soft: string;
  ink: string;
}

export interface AppEntry {
  id: string;
  name: string;
  blurb: string;
  url: string;
  who: string;
  light: Palette;
  dark: Palette;
  icon: string;
}

export interface Registry {
  apps: AppEntry[];
  switcherIcon: string;
  accountIcons: Record<string, string>;
  signOutUrl: string;
}

interface AppsEnv {
  INTERNAL_TOKEN?: string;
}

const HOME = process.env.HOME_URL || "http://atheos-home:8080";
const FRESH_MS = 60_000;
let cache: { at: number; registry: Registry } | null = null;
let asking: Promise<void> | null = null;

const isPalette = (p: unknown): p is Palette =>
  !!p && typeof p === "object" && ["app", "hover", "soft", "ink"].every((k) => typeof (p as Record<string, unknown>)[k] === "string");

/** A list from Home is used only if every app in it has what the switcher draws. */
export function isRegistry(r: unknown): r is Registry {
  if (!r || typeof r !== "object") return false;
  const x = r as Record<string, unknown>;
  return (
    Array.isArray(x.apps) &&
    x.apps.length > 0 &&
    x.apps.every((a) => {
      const e = a as Record<string, unknown>;
      return ["id", "name", "blurb", "url", "icon"].every((k) => typeof e?.[k] === "string") && isPalette(e.light) && isPalette(e.dark);
    }) &&
    typeof x.switcherIcon === "string" &&
    typeof x.signOutUrl === "string" &&
    !!x.accountIcons &&
    typeof x.accountIcons === "object"
  );
}

async function ask(token: string) {
  try {
    const res = await fetch(`${HOME}/internal/apps`, { headers: { "X-Internal-Token": token }, signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error(`Home answered ${res.status}`);
    const body: unknown = await res.json();
    if (!isRegistry(body)) throw new Error("Home's app list was not one");
    cache = { at: Date.now(), registry: body };
  } catch (error) {
    console.error("App list:", error instanceof Error ? error.message : error);
  }
}

/** The app list: Home's (or its last good answer), else the app's own copy. */
export async function appRegistry<T extends Registry>(env: AppsEnv, fallback: T): Promise<Registry> {
  if (!env.INTERNAL_TOKEN) return fallback;
  if (!cache || Date.now() - cache.at > FRESH_MS) {
    asking ??= ask(env.INTERNAL_TOKEN).finally(() => (asking = null));
    // A stale list is answered from at once; only the very first ask is waited for.
    if (!cache) await asking;
  }
  return cache ? cache.registry : fallback;
}

/** The icon files every app serves at its root, drawn by Home. */
export const ICON_FILES = ["apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "favicon.svg"];

/**
 * One of this app's icons, as Home draws it from the list (GET /internal/icons/<app>/<file>).
 * Without INTERNAL_TOKEN (a dev server), or while Home is away, there is none.
 */
export async function homeIcon(env: AppsEnv, app: string, file: string): Promise<Response> {
  if (!ICON_FILES.includes(file)) return new Response("Not found", { status: 404 });
  if (!env.INTERNAL_TOKEN) return new Response("Not found", { status: 404 });
  try {
    const res = await fetch(`${HOME}/internal/icons/${app}/${file}`, {
      headers: { "X-Internal-Token": env.INTERNAL_TOKEN },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return new Response("Not found", { status: res.status === 404 ? 404 : 503 });
    return new Response(await res.arrayBuffer(), {
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "image/png", "Cache-Control": "public, max-age=3600" },
    });
  } catch (error) {
    console.error("Icon:", error instanceof Error ? error.message : error);
    return new Response("Home is away", { status: 503 });
  }
}

/** For tests: forget what Home said. */
export function resetApps() {
  cache = null;
  asking = null;
}
