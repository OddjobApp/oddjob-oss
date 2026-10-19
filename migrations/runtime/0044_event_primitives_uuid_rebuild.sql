-- Rebuild `event_primitives` where it predates the uuid primary key.
--
-- Some environments carry a much older version of this table: `id` is a serial
-- INTEGER rather than a uuid, `confidence_score` is NUMERIC rather than real,
-- and every column is nullable. The drizzle schema has declared uuid +
-- NOT NULL for a long time, so on those databases the application cannot insert
-- a row at all — signal intelligence is inert, and migrations 0041/0042 could
-- add their spatial columns but not the
-- `rule_execution_audits.event_primitive_id` foreign key, because uuid cannot
-- reference integer.
--
-- SAFETY: this DROPS and recreates the table, so it runs ONLY when the table is
-- both mis-shaped AND empty. A mis-shaped table WITH rows raises instead of
-- silently discarding them — converting integer ids to uuid would mint new
-- identities, and that is a data-migration decision an operator must make
-- deliberately, not a side effect of running migrations.

DO $$
DECLARE
  id_type text;
  row_count bigint;
BEGIN
  SELECT data_type INTO id_type
    FROM information_schema.columns
   WHERE table_name = 'event_primitives' AND column_name = 'id';

  -- Table absent entirely: the baseline migration will create it correctly.
  IF id_type IS NULL THEN
    RAISE NOTICE 'event_primitives does not exist; nothing to rebuild.';
    RETURN;
  END IF;

  -- Already correct: no-op, so this migration is safe to re-run.
  IF id_type = 'uuid' THEN
    RAISE NOTICE 'event_primitives.id is already uuid; no rebuild needed.';
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM event_primitives' INTO row_count;

  IF row_count > 0 THEN
    RAISE EXCEPTION
      'event_primitives has a legacy % primary key and % row(s). Refusing to rebuild: '
      'converting integer ids to uuid would mint new identities. Export the rows, '
      'empty the table, and re-run.', id_type, row_count;
  END IF;

  RAISE NOTICE 'Rebuilding empty legacy event_primitives (id was %).', id_type;

  DROP TABLE event_primitives CASCADE;

  CREATE TABLE event_primitives (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      integer NOT NULL,
    source_entry_id      text NOT NULL,
    event_type           text NOT NULL,
    target_sector        text NOT NULL,
    jurisdiction         text NOT NULL,
    severity             text NOT NULL,
    source_url           text NOT NULL,
    extraction_timestamp timestamp NOT NULL,
    confidence_score     real NOT NULL,
    raw_text             text,
    flags                jsonb NOT NULL DEFAULT '[]'::jsonb,
    content_hash         text NOT NULL,
    -- `created_at` sits here, not last, to match the column order a freshly
    -- migrated database gets (baseline, then 0041/0042 appending spatial
    -- columns). Ordering is cosmetic for a named-column ORM, but keeping a
    -- rebuilt table identical to a fresh one removes a spurious difference
    -- from any future schema diff.
    created_at           timestamp DEFAULT now(),
    -- Spatial telemetry (0041) and provenance (0042) are recreated inline so a
    -- rebuilt table does not depend on those migrations running again.
    latitude             real,
    longitude            real,
    h3_index             text,
    previous_h3_index    text,
    dwell_minutes        real,
    velocity_knots       real,
    heading_degrees      real,
    projected_latitude   real,
    projected_longitude  real,
    flux_density_phi     real,
    cell_metrics         jsonb,
    subject_id           text,
    spatial_source       text,
    spatial_precision_m  real
  );

  CREATE INDEX idx_event_primitives_org          ON event_primitives (organization_id);
  CREATE INDEX idx_event_primitives_severity     ON event_primitives (severity);
  CREATE INDEX idx_event_primitives_sector       ON event_primitives (target_sector);
  CREATE INDEX idx_event_primitives_jurisdiction ON event_primitives (jurisdiction);
  CREATE INDEX idx_event_primitives_confidence   ON event_primitives (confidence_score);
  CREATE INDEX idx_event_primitives_hash         ON event_primitives (content_hash);
  CREATE INDEX idx_event_primitives_h3           ON event_primitives (h3_index);
  CREATE INDEX idx_event_primitives_subject
    ON event_primitives (organization_id, subject_id, extraction_timestamp);
END $$;

-- Now that the id types agree, the audit FK 0043 had to skip can be added.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'rule_execution_audits_event_primitive_id_fkey'
  ) THEN
    ALTER TABLE "rule_execution_audits"
      ADD CONSTRAINT "rule_execution_audits_event_primitive_id_fkey"
      FOREIGN KEY ("event_primitive_id") REFERENCES "event_primitives"("id") ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Skipped rule_execution_audits event FK: %', SQLERRM;
END $$;
