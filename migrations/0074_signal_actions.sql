CREATE TABLE IF NOT EXISTS signal_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id INTEGER NOT NULL,
  signal_id UUID NOT NULL REFERENCES event_primitives(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  performed_by TEXT NOT NULL,
  snoozed_until TIMESTAMP,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signal_actions_org ON signal_actions (organization_id);
CREATE INDEX IF NOT EXISTS idx_signal_actions_signal ON signal_actions (signal_id);
CREATE INDEX IF NOT EXISTS idx_signal_actions_active ON signal_actions (organization_id, signal_id, active);

-- Rollback: DROP TABLE IF EXISTS signal_actions;
