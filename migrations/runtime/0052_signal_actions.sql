-- Operator actions taken on a signal: dismiss, escalate, snooze.
--
-- `shared/schema/signal-intelligence.ts` has declared `signalActions` for a long
-- time and two mounted routers query it, but no migration ever created the
-- table — so it existed in no environment and both routes threw on every call:
--
--   GET  /api/signals/:id/actions   (signal-actions.routes.ts)      — timeline
--   POST /api/signals/bulk-action   (signal-bulk-actions.routes.ts) — triage
--
-- That is the entire triage surface of the signal feed. The UI for it exists and
-- shipped — ActionTimeline, BulkActionToolbar, useSignalAction, use-bulk-actions
-- — against a table that was never created, so every dismiss, escalate and
-- snooze failed and no signal could ever be actioned.
--
-- Found by `npm run check:schema-drift`, which is the point of that check: this
-- is the fifth instance of a schema declaration with no migration behind it, and
-- the first found by a machine rather than by someone hitting the 500.
--
-- Column definitions mirror the drizzle declaration exactly. `organization_id`
-- is a plain integer with no FK because the declaration has none — unlike
-- `signal_id`, which does declare its reference and cascade.

CREATE TABLE IF NOT EXISTS signal_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id INTEGER NOT NULL,
  -- CASCADE: an action on a purged signal is not a record worth keeping, and
  -- the timeline is always read through its signal.
  signal_id UUID NOT NULL REFERENCES event_primitives(id) ON DELETE CASCADE,
  -- BulkActionType: dismiss | escalate | snooze. Deliberately not CHECK-
  -- constrained, matching the declaration — the route validates the value and
  -- the set is expected to grow.
  action TEXT NOT NULL,
  performed_by TEXT NOT NULL,
  -- Only set for snooze actions.
  snoozed_until TIMESTAMP,
  -- The bulk route supersedes rather than deletes: it flips the previous action
  -- of the same type to inactive, then inserts the new one. So "the current
  -- state of this signal" is the active row, and the rest is history.
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index names match the drizzle declarations, so a later `drizzle-kit push`
-- sees no drift.
CREATE INDEX IF NOT EXISTS idx_signal_actions_org ON signal_actions (organization_id);
CREATE INDEX IF NOT EXISTS idx_signal_actions_signal ON signal_actions (signal_id);
-- The supersede lookup the bulk route performs on every write.
CREATE INDEX IF NOT EXISTS idx_signal_actions_active
  ON signal_actions (organization_id, signal_id, active);
