-- Hybrid clarification flow: toggle / exclusive phases before confirm

ALTER TABLE pending_meals ADD COLUMN phase TEXT DEFAULT 'confirm';
ALTER TABLE pending_meals ADD COLUMN clarify_plan_json TEXT;
ALTER TABLE pending_meals ADD COLUMN clarify_selected_json TEXT;
ALTER TABLE pending_meals ADD COLUMN clarify_exclusive_choice TEXT;
ALTER TABLE pending_meals ADD COLUMN ui_message_id TEXT;
