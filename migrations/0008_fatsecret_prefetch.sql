-- Background FatSecret enrichment for vision items during clarify UI

ALTER TABLE pending_meals ADD COLUMN fatsecret_prefetch_json TEXT;
