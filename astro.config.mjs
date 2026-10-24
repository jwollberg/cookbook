import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { defineConfig } from "astro/config";

import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

const site = process.env.SITE_URL || "https://hestia.atheosstudios.com";
// The folder the app is served from: "/" on hestia., "/hestia" when built for
// oikos.atheosstudios.com/hestia (plan-one-address-one-app). Links go through src/lib/base.ts.
const base = process.env.BASE_PATH || "/";

/**
 * Work around a React 19 + Vite dev-server interop bug.
 *
 * react/jsx-dev-runtime.js is a conditional CJS re-export:
 *
 *   if (process.env.NODE_ENV === 'production') { module.exports = require(...) }
 *   else { module.exports = require('./cjs/react-jsx-dev-runtime.development.js') }
 *
 * cjs-module-lexer cannot statically resolve named exports through that
 * branch, so Vite's dep optimizer emits `export default ...` with no named
 * `jsxDEV`. Every island then dies on hydration with "jsxDEV is not a
 * function" — server-rendered markup shows, but nothing is interactive.
 *
 * Pointing at the concrete development file lets the lexer see
 * `exports.jsxDEV = ...` directly. Resolved via react/package.json rather
 * than a bare specifier because React's exports map does not expose ./cjs/*.
 *
 * Harmless in production: `astro build` runs esbuild with jsxDev off, so
 * nothing imports jsx-dev-runtime, and Rollup handles the CJS interop
 * correctly anyway.
 */
const require = createRequire(import.meta.url);
const reactJsxDevRuntime = join(
  dirname(require.resolve("react/package.json")),
  "cjs",
  "react-jsx-dev-runtime.development.js",
);

export default defineConfig({
  site,
  base,
  // Every page is rendered per request by the Node server on Vault, behind sign-in. A
  // prerendered page would be a static file, and static files skip the gate.
  output: "server",
  adapter: node({ mode: "standalone" }),
  // Behind Cloudflare's tunnel the server hears plain HTTP; trusting the tunnel's
  // X-Forwarded-Proto for this one hostname gives every request its real https origin,
  // which the middleware's same-origin check on writes compares against.
  security: { allowedDomains: [{ hostname: new URL(site).hostname, protocol: "https" }] },
  integrations: [react()],

  vite: {
    plugins: [tailwindcss()],
    // Every script a page runs is a file of Hestia's own: the Content-Security-Policy
    // (src/lib/server/shared-address.ts) allows no inline script it doesn't name.
    build: { assetsInlineLimit: 0 },
    // Client only. Applied to the SSR environment as well, the raw CJS file
    // reaches Vite's module runner, which provides no `require` and throws
    // "require is not defined" while server-rendering the islands.
    environments: {
      client: {
        resolve: {
          alias: { "react/jsx-dev-runtime": reactJsxDevRuntime },
        },
      },
    },
  },
});
