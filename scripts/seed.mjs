/**
 * Load the starter library (seed/*.json) into the database.
 *
 *   node scripts/seed.mjs            # writes scripts/seed.sql
 *   npm run db:seed                  # ...and applies it to the dev database (.data/app.sqlite)
 *
 * INSERT OR IGNORE throughout: once the site is live the database is the
 * source of truth, and re-running the seed must never overwrite an edit made
 * in the app. It only fills in records that do not exist yet.
 *
 * The files are validated by src/lib/data.test.ts (schema + referential
 * integrity), so this script trusts them rather than re-validating.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SEED = join(ROOT, "seed");
const now = new Date().toISOString();

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const listJson = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => readJson(join(dir, f)));

/** SQLite string literal. */
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;

const insert = (table, id, doc) =>
  `INSERT OR IGNORE INTO ${table} (id, data, updated_at) VALUES (${lit(id)}, ${lit(JSON.stringify(doc))}, ${lit(now)});`;

const ingredients = readJson(join(SEED, "ingredients.json"));
const recipes = listJson(join(SEED, "recipes"));
const meals = listJson(join(SEED, "meals"));

const sql = [
  ...ingredients.map((i) => insert("ingredients", i.id, i)),
  ...recipes.map((r) => insert("recipes", r.id, r)),
  ...meals.map((m) => insert("meals", m.id, m)),
].join("\n");

const out = join(ROOT, "scripts", "seed.sql");
writeFileSync(out, `${sql}\n`);
console.log(
  `Wrote ${out}: ${ingredients.length} ingredients, ${recipes.length} recipes, ${meals.length} meals.`,
);
