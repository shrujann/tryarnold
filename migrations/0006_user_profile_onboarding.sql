-- TDEE onboarding profile fields (canonical kg/cm storage)

ALTER TABLE users ADD COLUMN gender TEXT;
ALTER TABLE users ADD COLUMN age INTEGER;
ALTER TABLE users ADD COLUMN weight_kg REAL;
ALTER TABLE users ADD COLUMN height_cm REAL;
ALTER TABLE users ADD COLUMN unit_preference TEXT DEFAULT 'metric';
ALTER TABLE users ADD COLUMN activity_level TEXT;
ALTER TABLE users ADD COLUMN fitness_goal TEXT;
ALTER TABLE users ADD COLUMN bmr REAL;
ALTER TABLE users ADD COLUMN tdee REAL;
ALTER TABLE users ADD COLUMN onboarding_step TEXT DEFAULT 'unit';

UPDATE users SET onboarding_step = 'done' WHERE onboarded = 1 AND onboarding_step IS NULL;
