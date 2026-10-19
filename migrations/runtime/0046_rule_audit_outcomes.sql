-- Record why a rule did NOT fire, not only that one did.
--
-- `rule_execution_audits` was written only when a rule passed, and a failed
-- evaluation was a console.warn and nothing else. So the question an operator
-- actually asks — "why didn't my rule fire?" — had no answer anywhere: a rule
-- that evaluated and legitimately did not match was indistinguishable from one
-- that threw halfway through, and both were indistinguishable from a rule that
-- was never reached.
--
-- `outcome` discriminates the three. `spatial_trace` carries the per-condition
-- explanations the predicate engine already produces (including the precision
-- gate's "position is unknown, not outside"), which until now were visible only
-- through the Rule Builder's dry run and never for a live signal.

ALTER TABLE rule_execution_audits
  ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'matched';

ALTER TABLE rule_execution_audits
  ADD COLUMN IF NOT EXISTS failure_reason TEXT;

ALTER TABLE rule_execution_audits
  ADD COLUMN IF NOT EXISTS spatial_trace JSONB;

-- Existing rows all predate the column and were, by construction, matches.
UPDATE rule_execution_audits SET outcome = 'matched' WHERE outcome IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rule_execution_audits_outcome_check'
  ) THEN
    ALTER TABLE rule_execution_audits
      ADD CONSTRAINT rule_execution_audits_outcome_check
      CHECK (outcome IN ('matched', 'no_match', 'error'));
  END IF;
END $$;

-- The lookup this exists to serve: every evaluation of one signal, in order.
CREATE INDEX IF NOT EXISTS idx_rule_audits_event
  ON rule_execution_audits (event_primitive_id, executed_at);

-- And "which of my rules are failing to evaluate at all", per org.
CREATE INDEX IF NOT EXISTS idx_rule_audits_outcome
  ON rule_execution_audits (organization_id, outcome, executed_at);
