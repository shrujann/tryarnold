PRAGMA foreign_keys=OFF;

CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER,
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
  id,
  telegram_id,
  username,
  first_name,
  timezone,
  goal_summary,
  target_calories,
  target_protein_g,
  target_carbs_g,
  target_fat_g,
  quiet_hours_start,
  quiet_hours_end,
  nudges_enabled,
  last_nudge_at,
  consent_health_data,
  phone_verified,
  onboarded,
  created_at,
  portion_multiplier,
  channel,
  external_user_id
)
SELECT
  id,
  telegram_id,
  username,
  first_name,
  timezone,
  goal_summary,
  target_calories,
  target_protein_g,
  target_carbs_g,
  target_fat_g,
  quiet_hours_start,
  quiet_hours_end,
  nudges_enabled,
  last_nudge_at,
  consent_health_data,
  phone_verified,
  onboarded,
  created_at,
  portion_multiplier,
  channel,
  external_user_id
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE UNIQUE INDEX ix_users_telegram_id ON users (telegram_id) WHERE telegram_id IS NOT NULL;
CREATE UNIQUE INDEX ix_users_channel_external ON users(channel, external_user_id);

PRAGMA foreign_keys=ON;
