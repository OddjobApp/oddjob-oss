-- Spatial telemetry columns on event_primitives.
--
-- Consumed by the spatial predicate engine (GRIE spatial conditions):
-- geofence triggers, containment predicates and Eulerian flux analytics.
-- All nullable — a signal without coordinates simply cannot satisfy a
-- spatial condition, which the engine reports rather than throwing.

ALTER TABLE "event_primitives" ADD COLUMN IF NOT EXISTS "latitude" real;
ALTER TABLE "event_primitives" ADD COLUMN IF NOT EXISTS "longitude" real;
ALTER TABLE "event_primitives" ADD COLUMN IF NOT EXISTS "h3_index" text;
ALTER TABLE "event_primitives" ADD COLUMN IF NOT EXISTS "previous_h3_index" text;
ALTER TABLE "event_primitives" ADD COLUMN IF NOT EXISTS "dwell_minutes" real;
ALTER TABLE "event_primitives" ADD COLUMN IF NOT EXISTS "velocity_knots" real;
ALTER TABLE "event_primitives" ADD COLUMN IF NOT EXISTS "heading_degrees" real;
ALTER TABLE "event_primitives" ADD COLUMN IF NOT EXISTS "projected_latitude" real;
ALTER TABLE "event_primitives" ADD COLUMN IF NOT EXISTS "projected_longitude" real;
ALTER TABLE "event_primitives" ADD COLUMN IF NOT EXISTS "flux_density_phi" real;
ALTER TABLE "event_primitives" ADD COLUMN IF NOT EXISTS "cell_metrics" jsonb;

-- Geofence membership is an equality lookup on the cell token, so a plain
-- btree index is what the O(1) set-membership path actually needs.
CREATE INDEX IF NOT EXISTS "idx_event_primitives_h3" ON "event_primitives" ("h3_index");
