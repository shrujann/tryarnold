-- Multi-channel user identity
ALTER TABLE users ADD COLUMN channel TEXT DEFAULT 'telegram';
ALTER TABLE users ADD COLUMN external_user_id TEXT;

UPDATE users SET channel = 'telegram' WHERE channel IS NULL;
UPDATE users SET external_user_id = CAST(telegram_id AS TEXT) WHERE external_user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ix_users_channel_external ON users(channel, external_user_id);

-- Channel-agnostic media references
ALTER TABLE meals ADD COLUMN media_ref TEXT;
UPDATE meals SET media_ref = tg_file_id WHERE media_ref IS NULL AND tg_file_id IS NOT NULL;

ALTER TABLE pending_meals ADD COLUMN media_ref TEXT;
UPDATE pending_meals SET media_ref = tg_file_id WHERE media_ref IS NULL AND tg_file_id IS NOT NULL;
