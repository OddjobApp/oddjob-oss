-- What an autonomous action actually produced.
--
-- Three of the four action types — create_rfc, update_compliance_check and
-- modify_spatial_routing — had no registered consumer at all. They published to
-- an empty room, and (before migration 0046 and the handler wiring) reported
-- success for it. There was nothing to consume them WITH: no RFC table, no
-- compliance-check table, no spatial-routing table. `shared/schema/compliance.ts`
-- is zod types with no persistence behind them.
--
-- Rather than invent three half-domains, the three share one artifact table.
-- What they genuinely have in common is that each produces a record a human or
-- an agent must then act on — a proposed change, a compliance finding, a routing
-- directive — attributable to the signal and the policy that caused it.
--
-- This is deliberately a substrate, not an integration. It records the decision,
-- its scope and its provenance, and makes them queryable. It does not file a
-- ticket in an external change-management system; wiring that up is a per-action
-- integration and belongs behind this table, not instead of it.

CREATE TABLE IF NOT EXISTS autonomous_action_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,

  -- Provenance: which signal caused this, and under which policy. Both nullable
  -- with ON DELETE SET NULL so purging signal history does not destroy the
  -- record of what was done about it.
  event_primitive_id UUID REFERENCES event_primitives(id) ON DELETE SET NULL,
  policy_id INTEGER REFERENCES autonomous_action_policies(id) ON DELETE SET NULL,

  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',

  -- Denormalised from the signal so the artifact reads on its own once the
  -- signal has aged out.
  severity TEXT,
  jurisdiction TEXT,
  target_sector TEXT,

  -- The entities this artifact covers. Its length is the observed blast radius
  -- reported back to the prediction-error loop.
  affected_entity_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,

  resolved_by TEXT,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'autonomous_action_artifacts_kind_check') THEN
    ALTER TABLE autonomous_action_artifacts
      ADD CONSTRAINT autonomous_action_artifacts_kind_check
      CHECK (kind IN ('rfc', 'compliance_finding', 'routing_directive'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'autonomous_action_artifacts_status_check') THEN
    ALTER TABLE autonomous_action_artifacts
      ADD CONSTRAINT autonomous_action_artifacts_status_check
      CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed'));
  END IF;
END $$;

-- The operator's queue: what is outstanding, newest first.
CREATE INDEX IF NOT EXISTS idx_action_artifacts_open
  ON autonomous_action_artifacts (organization_id, status, created_at DESC);

-- "What did this signal cause?" — the provenance lookup.
CREATE INDEX IF NOT EXISTS idx_action_artifacts_event
  ON autonomous_action_artifacts (event_primitive_id);

CREATE INDEX IF NOT EXISTS idx_action_artifacts_kind
  ON autonomous_action_artifacts (organization_id, kind, created_at DESC);
