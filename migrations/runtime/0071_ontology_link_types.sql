-- Ontology Link Types — the fourth AIP primitive.
--
-- Mirrors shared/schema/ontology/ontology.ts. A Link Type is a declared, named,
-- typed relationship between two Object Types, which is what turns the org's
-- Object Types from a set of flat lists into a graph an agent can traverse.
--
-- Two backings, mirroring the Object Type split:
--
--   derived      the relationship already exists as a foreign key on the source's
--                underlying table and the virtual adapters already project it into
--                their property maps (app_deployments.app_id, apps.project_id,
--                swarm_tasks.mission_id, ...). Nothing is stored here; the link is
--                resolved at query time, so it cannot go stale.
--   materialized an edge with no underlying foreign key, stored in ontology_links.
--
-- Every default Object Type is currently `virtual`, so every seeded link is
-- `derived`. ontology_links exists for org-defined materialized objects.
--
-- Guarded throughout, following 0069: an environment that already has these
-- tables gets a no-op rather than an error.

CREATE TABLE IF NOT EXISTS "ontology_link_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"inverse_name" text NOT NULL,
	"description" text,
	"source_type_id" integer NOT NULL,
	"target_type_id" integer,
	"cardinality" text DEFAULT 'one_to_many' NOT NULL,
	"backing" text DEFAULT 'derived' NOT NULL,
	"source_property" text,
	"target_property" text DEFAULT 'id',
	"target_type_property" text,
	"target_type_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ontology_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"link_type_id" integer NOT NULL,
	"source_object_id" integer NOT NULL,
	"target_object_id" integer NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Foreign keys. The cascade to orgs is the same isolation boundary the rest of
-- the ontology relies on: an org's links must not outlive it. Cascading from
-- ontology_object_types matters too — a dangling link type would resolve against
-- a type that no longer exists.
DO $$ BEGIN
	ALTER TABLE "ontology_link_types" ADD CONSTRAINT "ontology_link_types_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "ontology_link_types" ADD CONSTRAINT "ontology_link_types_source_type_id_ontology_object_types_id_fk" FOREIGN KEY ("source_type_id") REFERENCES "public"."ontology_object_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "ontology_link_types" ADD CONSTRAINT "ontology_link_types_target_type_id_ontology_object_types_id_fk" FOREIGN KEY ("target_type_id") REFERENCES "public"."ontology_object_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "ontology_links" ADD CONSTRAINT "ontology_links_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "ontology_links" ADD CONSTRAINT "ontology_links_link_type_id_ontology_link_types_id_fk" FOREIGN KEY ("link_type_id") REFERENCES "public"."ontology_link_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "ontology_links" ADD CONSTRAINT "ontology_links_source_object_id_ontology_objects_id_fk" FOREIGN KEY ("source_object_id") REFERENCES "public"."ontology_objects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "ontology_links" ADD CONSTRAINT "ontology_links_target_object_id_ontology_objects_id_fk" FOREIGN KEY ("target_object_id") REFERENCES "public"."ontology_objects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- Shape invariants. These are the ones a resolver would otherwise have to
-- discover at traversal time, on a link type that was already accepted: a
-- derived link with no source property has nothing to join on, and a polymorphic
-- one with no type property/map cannot name its target's Object Type. The same
-- rules are enforced in insertOntologyLinkTypeSchema; this is the backstop for
-- any writer that bypasses it.
DO $$ BEGIN
	ALTER TABLE "ontology_link_types" ADD CONSTRAINT "ontology_link_types_derived_needs_source_property" CHECK (
		"backing" <> 'derived' OR "source_property" IS NOT NULL
	);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "ontology_link_types" ADD CONSTRAINT "ontology_link_types_polymorphic_needs_type_property" CHECK (
		"target_type_id" IS NOT NULL OR "target_type_property" IS NOT NULL
	);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "ontology_link_types" ADD CONSTRAINT "ontology_link_types_backing_check" CHECK (
		"backing" IN ('derived', 'materialized')
	);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "ontology_link_types" ADD CONSTRAINT "ontology_link_types_cardinality_check" CHECK (
		"cardinality" IN ('one_to_one', 'one_to_many', 'many_to_many')
	);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- A stored edge must not point at itself: a self-link is always a bug, and it
-- makes traversal non-terminating.
DO $$ BEGIN
	ALTER TABLE "ontology_links" ADD CONSTRAINT "ontology_links_no_self_edge" CHECK (
		"source_object_id" <> "target_object_id"
	);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- Indexes. The org+source+name unique is scoped to the source type rather than
-- the org, because "owns" can legitimately mean different things from Project
-- and from App and both names are worth keeping. It is also what lets a link
-- seeder use ON CONFLICT DO NOTHING, the way seedDefaultObjectTypes does.
CREATE UNIQUE INDEX IF NOT EXISTS "ontology_link_type_org_source_name_unique" ON "ontology_link_types" USING btree ("organization_id","source_type_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_link_type_org_idx" ON "ontology_link_types" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_link_type_source_idx" ON "ontology_link_types" USING btree ("source_type_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_link_type_target_idx" ON "ontology_link_types" USING btree ("target_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ontology_link_type_src_tgt_unique" ON "ontology_links" USING btree ("organization_id","link_type_id","source_object_id","target_object_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_link_org_type_idx" ON "ontology_links" USING btree ("organization_id","link_type_id");--> statement-breakpoint
-- Inbound traversal reads by target; without this it is a sequential scan of
-- every edge in the org.
CREATE INDEX IF NOT EXISTS "ontology_link_target_idx" ON "ontology_links" USING btree ("organization_id","target_object_id");
