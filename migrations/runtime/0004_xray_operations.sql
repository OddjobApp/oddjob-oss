CREATE TABLE IF NOT EXISTS xray_operational_configs (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS xray_operational_configs_org_scope_unique
  ON xray_operational_configs (organization_id, scope);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS xray_operational_events (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  cycle_id INTEGER REFERENCES operational_cycles(id) ON DELETE SET NULL,
  mission_run_id INTEGER REFERENCES mission_runs(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  subject_node_id TEXT,
  severity TEXT NOT NULL,
  deduplication_key TEXT NOT NULL,
  deduplication_bucket TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  evaluation JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS xray_operational_events_dedupe_unique
  ON xray_operational_events (organization_id, scope, deduplication_key, deduplication_bucket);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS xray_operational_events_org_scope_created_idx
  ON xray_operational_events (organization_id, scope, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS xray_operational_events_cycle_idx
  ON xray_operational_events (cycle_id, created_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS xray_operational_notifications (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  event_id INTEGER NOT NULL REFERENCES xray_operational_events(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  recipient_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'unread',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_by TEXT,
  acknowledged_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS xray_operational_notifications_event_rule_unique
  ON xray_operational_notifications (event_id, rule_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS xray_operational_notifications_org_status_created_idx
  ON xray_operational_notifications (organization_id, status, created_at);
--> statement-breakpoint
