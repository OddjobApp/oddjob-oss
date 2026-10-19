-- Spatial provenance and subject identity on event_primitives.
--
-- `subject_id` ties successive observations of one tracked entity together,
-- which is what makes ON_ENTER / ON_EXIT transitions and dwell accumulation
-- possible at all.
--
-- `spatial_source` / `spatial_precision_m` record HOW a position was
-- determined. The predicate engine gates fine-grained predicates on this:
-- a signal placed at a country centroid (~500km accuracy) must not be allowed
-- to satisfy a 5km exclusion-zone rule and raise a false alert.

ALTER TABLE "event_primitives" ADD COLUMN IF NOT EXISTS "subject_id" text;
ALTER TABLE "event_primitives" ADD COLUMN IF NOT EXISTS "spatial_source" text;
ALTER TABLE "event_primitives" ADD COLUMN IF NOT EXISTS "spatial_precision_m" real;

-- The resolver reads a subject's most recent fix on every ingest; this index
-- serves that ordered lookup directly.
CREATE INDEX IF NOT EXISTS "idx_event_primitives_subject"
  ON "event_primitives" ("organization_id", "subject_id", "extraction_timestamp");
