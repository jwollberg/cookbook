/**
 * What Cloudflare's Workers runtime used to hand every request as `locals.runtime`, built
 * once on Vault from the process's environment: the settings and secrets (the container's
 * app.env; on a dev computer, `.dev.vars` under `astro dev`), the database (a SQLite file,
 * `DB_PATH`), the photos (a folder, `PHOTOS_DIR`), `cf.timezone` (the household's,
 * `TIME_ZONE`, where Cloudflare used to guess the visitor's), and `ctx.waitUntil`, which here
 * just lets the promise finish after the response.
 *
 * Also the one check the internal routes (/internal/…) make: the caller holds INTERNAL_TOKEN,
 * which only the Atheos containers on Vault have; the tunnel never routes /internal/ anyway.
 *
 * Canonical copy: Website-Home `vault/app-platform/platform.ts`; Kitchen adds the photos and
 * the time zone (Home's `vault/README.md`).
 */

import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { R2Bucket } from "./bucket";
import { openD1 } from "./d1";

export interface Runtime {
  env: Env;
  cf: { timezone?: string };
  ctx: { waitUntil(promise: Promise<unknown>): void };
}

let runtime: Runtime | undefined;

export function platform(): Runtime {
  if (!runtime) {
    if (import.meta.env.DEV && existsSync(".dev.vars")) process.loadEnvFile(".dev.vars");
    const env = { ...process.env } as unknown as Env;
    env.DB = openD1(process.env.DB_PATH ?? ".data/app.sqlite", process.env.MIGRATIONS_DIR ?? "migrations");
    env.PHOTOS = new R2Bucket(process.env.PHOTOS_DIR ?? ".data/photos");
    runtime = {
      env,
      cf: { timezone: process.env.TIME_ZONE || undefined },
      ctx: {
        waitUntil(promise) {
          promise.catch((error) => console.error("After the response:", error));
        },
      },
    };
  }
  return runtime;
}

/** Whether a request to /internal/ comes from another Atheos container on Vault. */
export function isInternal(request: Request, env: { INTERNAL_TOKEN?: string }): boolean {
  const expected = env.INTERNAL_TOKEN ?? "";
  const given = request.headers.get("X-Internal-Token") ?? "";
  if (expected.length < 32 || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
