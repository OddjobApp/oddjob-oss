-- Artifacts an agent rendered into the discussion (tier 2).
--
-- Tier 1 let agents CHECK things. Tier 2 lets them HAND the user something: an
-- intake form, an instant app, a pipeline input form. These tools return a rich
-- payload (`{"type":"instant_app",…}`) that the existing InstantAppRenderer
-- knows how to draw, so the artifact is stored on the turn and rendered in the
-- transcript rather than described in prose.
--
-- Shape: [{ "tool": "render_instant_app", "payload": { "type": "instant_app", … } }]
--
-- Idempotent: safe to re-run.

ALTER TABLE "crew_turns"
  ADD COLUMN IF NOT EXISTS "artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL;
