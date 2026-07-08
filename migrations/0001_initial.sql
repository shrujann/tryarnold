CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL UNIQUE,
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_users_telegram_id ON users (telegram_id);

CREATE TABLE goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT,
  target TEXT,
  target_date TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_goals_user_id ON goals (user_id);

CREATE TABLE meals (
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
  tg_file_id TEXT,
  tg_file_unique_id TEXT,
  photo_caption TEXT
);

CREATE INDEX ix_meals_user_id ON meals (user_id);
CREATE INDEX ix_meals_ts ON meals (ts);

CREATE TABLE workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ts TEXT,
  kind TEXT,
  duration_min INTEGER,
  notes TEXT
);

CREATE INDEX ix_workouts_user_id ON workouts (user_id);
CREATE INDEX ix_workouts_ts ON workouts (ts);

CREATE TABLE metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ts TEXT,
  kind TEXT,
  value REAL,
  unit TEXT
);

CREATE INDEX ix_metrics_user_id ON metrics (user_id);
CREATE INDEX ix_metrics_ts ON metrics (ts);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ts TEXT,
  direction TEXT,
  channel TEXT DEFAULT 'telegram',
  content TEXT,
  kind TEXT DEFAULT 'text'
);

CREATE INDEX ix_messages_user_id ON messages (user_id);
CREATE INDEX ix_messages_ts ON messages (ts);
