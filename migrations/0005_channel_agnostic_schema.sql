-- Channel-agnostic media refs and user identity (drop Telegram-specific columns)

-- meals: media_ref + media_unique_ref only
ALTER TABLE meals ADD COLUMN media_unique_ref TEXT;
UPDATE meals SET media_unique_ref = tg_file_unique_id
  WHERE media_unique_ref IS NULL AND tg_file_unique_id IS NOT NULL;
UPDATE meals SET media_ref = tg_file_id
  WHERE media_ref IS NULL AND tg_file_id IS NOT NULL;

-- pending_meals: media_ref + media_unique_ref only
ALTER TABLE pending_meals ADD COLUMN media_unique_ref TEXT;
UPDATE pending_meals SET media_unique_ref = tg_file_unique_id
  WHERE media_unique_ref IS NULL AND tg_file_unique_id IS NOT NULL;
UPDATE pending_meals SET media_ref = tg_file_id
  WHERE media_ref IS NULL AND tg_file_id IS NOT NULL;

-- SQLite table rebuild to drop legacy Telegram columns from meals
PRAGMA foreign_keys=OFF;

CREATE TABLE meals_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ts TEXT,
  source TEXT,
  meal_type TEXT,
  description TEXT,
  calories REAL DEFAULT 0,
  protein_g REAL DEFAULT 0,
  carbs_g REAL DEFAULT 0,
  fat_g REAL DEFAULT 0,
  confidence REAL,
  items_json TEXT,
  media_ref TEXT,
  media_unique_ref TEXT,
  photo_caption TEXT
);

INSERT INTO meals_new (
  id, user_id, ts, source, meal_type, description, calories, protein_g, carbs_g, fat_g,
  confidence, items_json, media_ref, media_unique_ref, photo_caption
)
SELECT
  id, user_id, ts, source, meal_type, description, calories, protein_g, carbs_g, fat_g,
  confidence, items_json, media_ref, media_unique_ref, photo_caption
FROM meals;

DROP TABLE meals;
ALTER TABLE meals_new RENAME TO meals;
CREATE INDEX ix_meals_user_id ON meals (user_id);
CREATE INDEX ix_meals_ts ON meals (ts);

CREATE TABLE pending_meals_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  estimate_json TEXT,
  base_multiplier REAL DEFAULT 1.0,
  media_ref TEXT,
  media_unique_ref TEXT,
  photo_caption TEXT,
  created_at TEXT
);

INSERT INTO pending_meals_new (
  id, user_id, estimate_json, base_multiplier, media_ref, media_unique_ref, photo_caption, created_at
)
SELECT
  id, user_id, estimate_json, base_multiplier, media_ref, media_unique_ref, photo_caption, created_at
FROM pending_meals;

DROP TABLE pending_meals;
ALTER TABLE pending_meals_new RENAME TO pending_meals;
CREATE UNIQUE INDEX ix_pending_meals_user_id ON pending_meals (user_id);

-- users: channel + external_user_id only (drop telegram_id)
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  first_name TEXT,
  timezone TEXT DEFAULT 'UTC',
  goal_summary TEXT,
  target_calories INTEGER,
  target_protein_g INTEGER,
  target_carbs_g INTEGER,
  target_fat_g INTEGER,
  quiet_hours_start INTEGER,
  quiet_hours_end INTEGER,
  nudges_enabled INTEGER DEFAULT 1,
  last_nudge_at TEXT,
  consent_health_data INTEGER DEFAULT 0,
  phone_verified INTEGER DEFAULT 0,
  onboarded INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  portion_multiplier REAL DEFAULT 1.0 NOT NULL,
  channel TEXT DEFAULT 'telegram',
  external_user_id TEXT
);

INSERT INTO users_new (
  id, username, first_name, timezone, goal_summary, target_calories, target_protein_g,
  target_carbs_g, target_fat_g, quiet_hours_start, quiet_hours_end, nudges_enabled,
  last_nudge_at, consent_health_data, phone_verified, onboarded, created_at,
  portion_multiplier, channel, external_user_id
)
SELECT
  id, username, first_name, timezone, goal_summary, target_calories, target_protein_g,
  target_carbs_g, target_fat_g, quiet_hours_start, quiet_hours_end, nudges_enabled,
  last_nudge_at, consent_health_data, phone_verified, onboarded, created_at,
  portion_multiplier, channel, external_user_id
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE UNIQUE INDEX ix_users_channel_external ON users(channel, external_user_id);

PRAGMA foreign_keys=ON;
