/**
 * Request-scoped access to bindings and secrets.
 */

import type { Viewer } from "./db";

/**
 * The signing secret. Development falls back to a fixed value so the dev
 * server works with no .dev.vars at all; `import.meta.env.DEV` is replaced
 * with `false` at build time, so the fallback does not exist in production.
 */
export function sessionSecret(env: Env): string | undefined {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  return import.meta.env.DEV ? "kitchen-dev-only-session-secret" : undefined;
}

/** The local stand-in account the dev server offers when Google is not configured. */
export const DEV_USER = {
  id: "dev",
  email: "dev@localhost",
  name: "Dev Cook",
  picture: null,
} as const;

export function isDevViewer(viewer: Pick<Viewer, "id">): boolean {
  return import.meta.env.DEV && viewer.id === DEV_USER.id;
}

export function googleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && sessionSecret(env));
}
