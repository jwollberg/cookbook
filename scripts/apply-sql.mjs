// Applies a SQL file to the app's SQLite database: the starter library (scripts/seed.sql, from
// scripts/seed.mjs) into a dev database, which `npm run dev` creates with its migrations on the
// first request. Usage: node scripts/apply-sql.mjs <file.sql> [database, default .data/app.sqlite]
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [file, path = ".data/app.sqlite"] = process.argv.slice(2);
if (!file) throw new Error("usage: node scripts/apply-sql.mjs <file.sql> [database]");
const db = new DatabaseSync(path);
db.exec("PRAGMA foreign_keys = ON; BEGIN;");
db.exec(readFileSync(file, "utf8"));
db.exec("COMMIT;");
db.close();
console.log(`${file} applied to ${path}`);
