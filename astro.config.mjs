import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { defineConfig } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

const site = process.env.SITE_URL || "https://cookbook.atheosstudios.com";
const base = process.env.SITE_BASE || "/";

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
  output: "static",
  integrations: [react(), sitemap()],

  vite: {
    plugins: [tailwindcss()],
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
