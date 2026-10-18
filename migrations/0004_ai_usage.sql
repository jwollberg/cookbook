-- Claude's use, counted per person (users.id), month and model, for the monthly cap
-- (src/lib/server/claude.ts, AI_USAGE_SQL). /internal/forget deletes a person's rows.
CREATE TABLE ai_usage (
  owner TEXT NOT NULL,
  month TEXT NOT NULL,
  model TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, month, model)
);
