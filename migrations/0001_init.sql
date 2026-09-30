-- Kitchen schema.
--
-- One shared library (ingredients, recipes, meals) that every approved user
-- reads and edits, and per-household planning (week plans, the shopping list,
-- the pantry). Any approved user may work in any household.
--
-- Library and planning records are stored as JSON documents and validated by
-- the zod schemas in src/lib/schema.ts on every read and write. The model was
-- designed as documents — a recipe is one file's worth of data — and the
-- aggregation code consumes whole documents, so normalising them into columns
-- would buy nothing but a mapping layer to keep in sync.

CREATE TABLE users (
  id           TEXT PRIMARY KEY,            -- Google `sub`: stable even if the address changes
  email        TEXT NOT NULL UNIQUE,
  name         TEXT,
  picture      TEXT,
  household_id TEXT,                        -- the household they are working in right now
  created_at   TEXT NOT NULL,
  seen_at      TEXT NOT NULL
);

CREATE TABLE households (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- ---- shared library ------------------------------------------------------

CREATE TABLE ingredients (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE recipes (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE meals (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- ---- per household -------------------------------------------------------

CREATE TABLE plans (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  id           TEXT NOT NULL,               -- week-YYYY-MM-DD
  data         TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  updated_by   TEXT,
  PRIMARY KEY (household_id, id)
);

-- What is on the list beyond the plan: dishes, hand-added items, and which
-- plan feeds it. `updated_at` doubles as the optimistic-concurrency token,
-- since two people in one household can add to the list at the same time.
CREATE TABLE shopping (
  household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  data         TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  updated_by   TEXT
);

-- Ticks are rows rather than part of the list document: they are toggled
-- fast, by more than one phone in the same store, and a row insert or delete
-- can never conflict the way a rewritten document can.
CREATE TABLE shopping_ticks (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  line_key     TEXT NOT NULL,
  ticked_at    TEXT NOT NULL,
  PRIMARY KEY (household_id, line_key)
);

CREATE TABLE pantry (
  household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  data         TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
