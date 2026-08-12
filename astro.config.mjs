import { defineConfig } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

const site = process.env.SITE_URL || "https://cookbook.atheosstudios.com";
const base = process.env.SITE_BASE || "/";

export default defineConfig({
  site,
  base,
  output: "static",
  integrations: [react(), sitemap()],

  vite: {
    plugins: [tailwindcss()],
  },
});
