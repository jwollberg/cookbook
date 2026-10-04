/// <reference types="astro/client" />

type D1Database = import("@cloudflare/workers-types").D1Database;
type R2Bucket = import("@cloudflare/workers-types").R2Bucket;

/** Bindings and secrets — see wrangler.jsonc. */
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
}

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    /** Set by the middleware on every request except robots.txt. */
    viewer: import("./lib/server/db").Viewer;
    household: import("./lib/server/db").Household;
    /** Josh: the app switcher shows him every app, everyone else Home and Kitchen. */
    owner: boolean;
  }
}

/** Workers RPC, as much of it as src/worker.ts uses (the bundled types lag behind). */
declare module "cloudflare:workers" {
  export abstract class WorkerEntrypoint<E = unknown> {
    protected readonly env: E;
    protected readonly ctx: import("@cloudflare/workers-types").ExecutionContext;
    constructor(ctx: import("@cloudflare/workers-types").ExecutionContext, env: E);
  }
}
