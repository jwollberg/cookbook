/**
 * The Worker entry: Astro's request handler, plus `Glance` — the RPC
 * entrypoint home.atheosstudios.com calls for Kitchen's tile.
 *
 * An RPC entrypoint is reachable only through a service binding from another
 * Worker in this account, never from the internet, so it needs no login of
 * its own; it still answers only for people on ALLOWED_EMAILS.
 */

import type { ExecutionContext } from "@cloudflare/workers-types";
import { WorkerEntrypoint } from "cloudflare:workers";
import type { SSRManifest } from "astro";
import { App } from "astro/app";
import { handle } from "@astrojs/cloudflare/handler";
import { isAllowed } from "./lib/server/auth";
import { kitchenGlance, type KitchenGlance } from "./lib/server/glance";

type HandlerEnv = Parameters<typeof handle>[3];

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export class Glance extends WorkerEntrypoint<Env> {
  async summary(input: { email: string; today: string }): Promise<KitchenGlance | null> {
    if (!isAllowed(input?.email, this.env.ALLOWED_EMAILS) || !isDay(input?.today)) return null;
    return kitchenGlance(this.env, input.email, input.today);
  }
}

export function createExports(manifest: SSRManifest) {
  const app = new App(manifest);
  return {
    default: {
      async fetch(request: Parameters<typeof handle>[2], env: HandlerEnv, ctx: ExecutionContext) {
        return handle(manifest, app, request, env, ctx);
      },
    },
    Glance,
  };
}
