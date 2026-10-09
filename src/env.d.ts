/// <reference types="astro/client" />

type D1Database = import("./lib/server/d1").D1Database;
type R2Bucket = import("./lib/server/bucket").R2Bucket;

/** The settings and secrets (app.env on Vault), the database and the photos. */
interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  APP_URL?: string;
  /** atheosstudios.cloudflareaccess.com — whose keys sign the Access JWT. */
  ACCESS_TEAM_DOMAIN?: string;
  /** This app's Access audience tag. */
  ACCESS_AUD?: string;
  /** Comma-separated; the only accounts that may use Kitchen. */
  ALLOWED_EMAILS?: string;
  /** Comma-separated; who sees every Atheos app in the switcher (Josh). */
  OWNER_EMAILS?: string;
  /** The household's time zone, for "today" (America/Chicago). */
  TIME_ZONE?: string;
  /** Shared by the Atheos containers on Vault; lets Home ask /internal/glance. */
  INTERNAL_TOKEN?: string;
}

declare namespace App {
  interface Locals {
    /** Set first by the middleware on every request (src/lib/server/platform.ts). */
    runtime: import("./lib/server/platform").Runtime;
    /** Set by the middleware on every request except robots.txt. */
    viewer: import("./lib/server/db").Viewer;
    household: import("./lib/server/db").Household;
    /** Josh: the app switcher shows him every app, everyone else Home and Kitchen. */
    owner: boolean;
  }
}
