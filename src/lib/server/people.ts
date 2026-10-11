/**
 * Who may use this app: Home's People list (home.atheosstudios.com/people), the one place Josh
 * invites people and chooses their apps. Asked across Vault's Docker network
 * (GET http://atheos-home:8080/internal/people, with INTERNAL_TOKEN), kept for half a minute,
 * and the last good answer kept while Home is away (a restart, a deploy). Until Home has
 * answered once, the app's own ALLOWED_EMAILS / OWNER_EMAILS / PEOPLE (its app.env) stand in,
 * so its owner is never locked out by Home being down. Cloudflare Access, which Home keeps in
 * step with the same list, still stands in front of every app.
 *
 * Canonical copy: Website-Home `vault/app-platform/people.ts`; each app carries a copy at
 * src/lib/server/people.ts (Home's `vault/README.md`, The apps' platform).
 */

export interface Person {
  email: string;
  name: string;
  owner: boolean;
  apps: string[];
}

export interface Access {
  allowed: boolean;
  owner: boolean;
  name: string;
  /** every app this person may open, for the app switcher */
  apps: string[];
}

interface PeopleEnv {
  INTERNAL_TOKEN?: string;
  ALLOWED_EMAILS?: string;
  OWNER_EMAILS?: string;
  PEOPLE?: string;
}

const HOME = process.env.PEOPLE_URL || "http://atheos-home:8080/internal/people";
const FRESH_MS = 30_000;
let cache: { at: number; people: Person[] } | null = null;
let asking: Promise<void> | null = null;

/** Compare the way Gmail does: case, dots and +tags in the local part don't matter. */
export function normalizeEmail(email: string): string {
  const [local, domain] = email.trim().toLowerCase().split("@");
  if (!domain) return email.trim().toLowerCase();
  if (domain === "gmail.com" || domain === "googlemail.com") return `${local.split("+")[0].replace(/\./g, "")}@gmail.com`;
  return `${local}@${domain}`;
}

/**
 * The key a person's own data is kept under in every app (its `owner` column): the normalized
 * email, so case, dots and +tags never split one person in two. Every read and write of their
 * data is filtered by it in the app's data layer.
 */
export const ownerKey = (email: string): string => normalizeEmail(email);

const list = (raw: string | undefined) => (raw ?? "").split(/[\s,;]+/).map((s) => s.trim()).filter((s) => s.includes("@"));

/** The app's own lists, as it had them before the People list: its stand-in while Home is away. */
export function fromEnv(env: PeopleEnv, app: string): Person[] {
  const owners = new Set(list(env.OWNER_EMAILS).map(normalizeEmail));
  const names = new Map<string, string>();
  for (const pair of (env.PEOPLE ?? "").split(",")) {
    const [e, n] = pair.split("=").map((s) => s?.trim());
    if (e && n) names.set(normalizeEmail(e), n);
  }
  return [...new Set([...list(env.ALLOWED_EMAILS), ...list(env.OWNER_EMAILS)])].map((email) => ({
    email,
    name: names.get(normalizeEmail(email)) ?? email.split("@")[0],
    owner: owners.has(normalizeEmail(email)),
    apps: [app],
  }));
}

async function ask(token: string) {
  try {
    const res = await fetch(HOME, { headers: { "X-Internal-Token": token }, signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error(`Home answered ${res.status}`);
    const body = (await res.json()) as { people?: Person[] };
    if (!Array.isArray(body.people)) throw new Error("Home's answer had no people");
    cache = { at: Date.now(), people: body.people };
  } catch (error) {
    console.error("People list:", error instanceof Error ? error.message : error);
  }
}

/** Everyone, from Home (or its last good answer, or the app's own lists until Home answers). */
export async function people(env: PeopleEnv, app: string): Promise<Person[]> {
  if (!env.INTERNAL_TOKEN) return fromEnv(env, app);
  if (!cache || Date.now() - cache.at > FRESH_MS) {
    asking ??= ask(env.INTERNAL_TOKEN).finally(() => (asking = null));
    // A stale list is answered from at once; only the very first ask is waited for.
    if (!cache) await asking;
  }
  return cache ? cache.people : fromEnv(env, app);
}

/** May this person use this app, do they own the list, and what to call them. */
export async function accessFor(email: string | undefined, app: string, env: PeopleEnv): Promise<Access> {
  const none: Access = { allowed: false, owner: false, name: "", apps: [] };
  if (!email) return none;
  const want = normalizeEmail(email);
  const p = (await people(env, app)).find((x) => normalizeEmail(x.email) === want);
  if (!p) return none;
  return { allowed: p.apps.includes(app), owner: p.owner, name: p.name, apps: p.apps };
}

/** For tests: forget what Home said. */
export function resetPeople() {
  cache = null;
  asking = null;
}
