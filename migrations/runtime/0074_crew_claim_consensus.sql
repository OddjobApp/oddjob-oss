ALTER TABLE crew_claims
    ADD COLUMN IF NOT EXISTS positions jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS agreement_level integer;
