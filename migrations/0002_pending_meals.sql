ALTER TABLE users ADD COLUMN portion_multiplier REAL DEFAULT 1.0 NOT NULL;

CREATE TABLE pending_meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  estimate_json TEXT,
  base_multiplier REAL DEFAULT 1.0,
  tg_file_id TEXT,
  tg_file_unique_id TEXT,
  photo_caption TEXT,
  created_at TEXT
);

CREATE UNIQUE INDEX ix_pending_meals_user_id ON pending_meals (user_id);
