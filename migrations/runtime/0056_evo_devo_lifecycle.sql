CREATE TABLE IF NOT EXISTS evo_devo_stage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  phenotype_id UUID NOT NULL REFERENCES evo_devo_phenotypes(id) ON DELETE RESTRICT,
  from_stage TEXT,
  to_stage TEXT NOT NULL CHECK (to_stage IN ('embryonic','validation','differentiation','sandbox','shadow','canary','mature','suspended','retired','failed')),
  action TEXT NOT NULL CHECK (action IN ('initialize','promote','rollback','kill','retire','fail')),
  evidence JSONB NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS evo_devo_stage_phenotype_idx ON evo_devo_stage_events (phenotype_id, created_at);
DROP TRIGGER IF EXISTS evo_devo_stage_events_immutable ON evo_devo_stage_events;
CREATE TRIGGER evo_devo_stage_events_immutable BEFORE UPDATE ON evo_devo_stage_events
FOR EACH ROW EXECUTE FUNCTION reject_evo_devo_record_update();
