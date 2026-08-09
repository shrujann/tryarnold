-- Store a proposed meal edit until the user confirms adjustment.

ALTER TABLE pending_meals ADD COLUMN proposed_estimate_json TEXT;
