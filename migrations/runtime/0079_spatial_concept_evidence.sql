-- Spatial Concept Evidence: provenance for knowledge promoted from signals.
--
-- knowledge_topic_concepts is a bare (topic_id, concept_id) primary key, which
-- can record THAT a place has a concept but not when, from which observation,
-- under which rule, or how strongly. Without that, nothing decays, nothing is
-- retractable, and a continuously running collector only ever accumulates
-- assertions. This table is the layer that makes concept strength a
-- time-decayed aggregate over evidence instead of a count of links.
--
-- Two deliberate omissions:
--
--   No FK to event_primitives. Primitives are subject to retention pruning, and
--   losing the observation must not delete the record that we once learned
--   something from it. The id is kept as a trace, not as a constraint.
--
--   No FK to spatial_regions. A region can be soft-deleted or re-drawn; the
--   evidence describes what was true when it was observed, and repointing or
--   erasing it on a boundary edit would rewrite history.
--
-- severity, confidence, h3_index and the resolution live here rather than
-- becoming concepts: they vary per observation, and as concept names they would
-- shatter the vocabulary into one term per reading.

CREATE TABLE IF NOT EXISTS "spatial_concept_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"project_id" integer,
	"concept_id" integer NOT NULL,
	"topic_id" integer NOT NULL,
	"event_primitive_id" uuid NOT NULL,
	"region_id" integer,
	"rule_id" text,
	"mauf_score" real,
	"severity" text,
	"confidence" real,
	"h3_index" text,
	"h3_resolution" integer,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ADD CONSTRAINT has no IF NOT EXISTS, so each is guarded individually the same
-- way 0077 and 0078 guard theirs.
DO $$ BEGIN
  BEGIN
    ALTER TABLE "spatial_concept_evidence" ADD CONSTRAINT "spatial_concept_evidence_organization_id_fk"
      FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  -- Deleting a concept or topic removes the evidence behind it: the row exists
  -- only to explain an assertion that no longer exists.
  BEGIN
    ALTER TABLE "spatial_concept_evidence" ADD CONSTRAINT "spatial_concept_evidence_concept_id_fk"
      FOREIGN KEY ("concept_id") REFERENCES "public"."knowledge_concepts"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "spatial_concept_evidence" ADD CONSTRAINT "spatial_concept_evidence_topic_id_fk"
      FOREIGN KEY ("topic_id") REFERENCES "public"."knowledge_topics"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- Replay safety: the promotion consumer reads an async stream, so the same
-- primitive can legitimately arrive twice. A redelivery must update the row
-- rather than inflate the evidence behind a concept.
CREATE UNIQUE INDEX IF NOT EXISTS "spatial_concept_evidence_concept_event_unq"
  ON "spatial_concept_evidence" USING btree ("concept_id","event_primitive_id");

CREATE INDEX IF NOT EXISTS "idx_spatial_concept_evidence_scope"
  ON "spatial_concept_evidence" USING btree ("organization_id","project_id","topic_id");
CREATE INDEX IF NOT EXISTS "idx_spatial_concept_evidence_cell"
  ON "spatial_concept_evidence" USING btree ("h3_index");
CREATE INDEX IF NOT EXISTS "idx_spatial_concept_evidence_observed"
  ON "spatial_concept_evidence" USING btree ("observed_at");
