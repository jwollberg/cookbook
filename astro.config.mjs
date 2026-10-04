import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { defineConfig } from "astro/config";

import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

const site = process.env.SITE_URL || "https://kitchen.atheosstudios.com";

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
  // Every page is rendered per request by the Worker, behind sign-in. A
  // prerendered page would be a static file, and static files skip the gate.
  output: "server",
  adapter: cloudflare({
    // `astro dev` gets real local D1 and R2 bindings from wrangler.jsonc.
    platformProxy: { enabled: true },
    // Our own entry adds `Glance`, the RPC entrypoint Home's Kitchen tile calls.
    workerEntryPoint: { path: "src/worker.ts", namedExports: ["Glance"] },
  }),
  integrations: [react()],

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      // React 19's default server renderer reaches for MessageChannel, which
      // the Workers runtime does not provide; its edge build does not.
      alias: import.meta.env.PROD ? { "react-dom/server": "react-dom/server.edge" } : undefined,
    },
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
