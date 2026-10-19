-- Durable per-URL concept vocabulary for tracked properties.
--
-- Concept resolution is a per-URL cost, not a per-event one. The in-process
-- cache in concept-resolver.ts is only L1: ingest runs in a BullMQ worker at
-- concurrency 20 (and potentially multiple processes), so without a shared L2
-- store the same URL is re-resolved constantly.
--
-- normalized_url stores the output of normalizeUrl() — tracking params
-- stripped, fragment dropped, remaining params sorted. Storing raw URLs would
-- fragment a single page into one row per campaign tag, which is exactly the
-- cost this table exists to avoid.

CREATE TABLE IF NOT EXISTS "prospect_page_concepts" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"project_id" integer,
	"property_id" integer,
	"normalized_url" text NOT NULL,
	"page_title" text,
	"concepts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'heuristic' NOT NULL,
	"resolver_version" text,
	"resolved_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "prospect_page_concepts"
   ADD CONSTRAINT "prospect_page_concepts_organization_id_orgs_org_id_fk"
   FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "prospect_page_concepts"
   ADD CONSTRAINT "prospect_page_concepts_property_id_prospect_properties_id_fk"
   FOREIGN KEY ("property_id") REFERENCES "public"."prospect_properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prospect_page_concepts_lookup_idx"
  ON "prospect_page_concepts" ("organization_id", "property_id", "normalized_url");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospect_page_concepts_org_idx"
  ON "prospect_page_concepts" ("organization_id");
