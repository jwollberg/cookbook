/// <reference types="astro/client" />

type D1Database = import("@cloudflare/workers-types").D1Database;
type R2Bucket = import("@cloudflare/workers-types").R2Bucket;

/** Bindings and secrets — see wrangler.jsonc. */
interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  APP_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  ALLOWED_EMAILS?: string;
}

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    /** Set by the middleware on every signed-in request; absent only on /login and /auth/*. */
    viewer: import("./lib/server/db").Viewer;
    household: import("./lib/server/db").Household;
  }
}
