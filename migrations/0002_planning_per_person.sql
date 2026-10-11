-- Planning belongs to a person, not a household.
--
-- The library (ingredients, recipes, meals) stays one shared book. Week plans,
-- the shopping list, its ticks and the pantry are now each person's own, keyed
-- by users.id, and households are gone: each household's rows go to the person
-- who made it (households.created_by), and then the household is dropped.
--
-- If one person made more than one household, their rows would meet on the new
-- keys, so the most recently updated copy wins, the same way every time:
--   * a week plan: the copy of that week updated last;
--   * the shopping list: the household whose list saw anything last (its last
--     edit or its last tick), and its ticks come with it, never mixed in from
--     another list;
--   * the pantry: the copy updated last.
-- A tie on the time goes to the larger household id, so a rerun gives the same
-- answer. Rows of a household whose maker has no users row cannot be anyone's
-- and are left behind (households.created_by has always been a foreign key to
-- users, so there are none).
--
-- SQLite cannot change a table's key in place, so each table is rebuilt: create
-- the new one, copy, drop the old one, rename. The runner applies this file in
-- one transaction with foreign keys on; the old tables are dropped children
-- first, so dropping households cascades into nothing.

CREATE TABLE plans_new (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,                 -- week-YYYY-MM-DD
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (user_id, id)
);

INSERT INTO plans_new (user_id, id, data, updated_at, updated_by)
SELECT user_id, id, data, updated_at, updated_by FROM (
  SELECT h.created_by AS user_id, p.id, p.data, p.updated_at, p.updated_by,
         ROW_NUMBER() OVER (
           PARTITION BY h.created_by, p.id
           ORDER BY p.updated_at DESC, p.household_id DESC
         ) AS n
  FROM plans p
  JOIN households h ON h.id = p.household_id
  JOIN users u ON u.id = h.created_by
)
WHERE n = 1;

-- Each maker's one list: the household whose list was touched last.
CREATE TEMP TABLE kept_list AS
SELECT household_id, user_id FROM (
  SELECT h.id AS household_id, h.created_by AS user_id,
         ROW_NUMBER() OVER (
           PARTITION BY h.created_by
           ORDER BY max(
             coalesce(s.updated_at, ''),
             coalesce((SELECT max(t.ticked_at) FROM shopping_ticks t WHERE t.household_id = h.id), '')
           ) DESC, h.id DESC
         ) AS n
  FROM households h
  JOIN users u ON u.id = h.created_by
  LEFT JOIN shopping s ON s.household_id = h.id
)
WHERE n = 1;

CREATE TABLE shopping_new (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

INSERT INTO shopping_new (user_id, data, updated_at, updated_by)
SELECT k.user_id, s.data, s.updated_at, s.updated_by
FROM shopping s
JOIN kept_list k ON k.household_id = s.household_id;

CREATE TABLE shopping_ticks_new (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  line_key  TEXT NOT NULL,
  ticked_at TEXT NOT NULL,
  PRIMARY KEY (user_id, line_key)
);

INSERT INTO shopping_ticks_new (user_id, line_key, ticked_at)
SELECT k.user_id, t.line_key, t.ticked_at
FROM shopping_ticks t
JOIN kept_list k ON k.household_id = t.household_id;

CREATE TABLE pantry_new (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO pantry_new (user_id, data, updated_at)
SELECT user_id, data, updated_at FROM (
  SELECT h.created_by AS user_id, p.data, p.updated_at,
         ROW_NUMBER() OVER (
           PARTITION BY h.created_by
           ORDER BY p.updated_at DESC, p.household_id DESC
         ) AS n
  FROM pantry p
  JOIN households h ON h.id = p.household_id
  JOIN users u ON u.id = h.created_by
)
WHERE n = 1;

DROP TABLE kept_list;

DROP TABLE plans;
DROP TABLE shopping_ticks;
DROP TABLE shopping;
DROP TABLE pantry;
DROP TABLE households;

ALTER TABLE plans_new RENAME TO plans;
ALTER TABLE shopping_new RENAME TO shopping;
ALTER TABLE shopping_ticks_new RENAME TO shopping_ticks;
ALTER TABLE pantry_new RENAME TO pantry;

-- Which household someone was working in: there are none to choose from now.
ALTER TABLE users DROP COLUMN household_id;
