-- Ontology Type Versions
--
-- Records immutable snapshots of ontology object type definitions each time a
-- definition is created or modified. Supports full version history queries and
-- the ontology migration workflow. Version numbers are monotonically increasing
-- integers starting at 1, scoped per entity type.

CREATE TABLE "ontology_type_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"object_type_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"version" integer NOT NULL,
	"definition_snapshot" jsonb NOT NULL,
	"actor_user_id" text NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ontology_type_versions" ADD CONSTRAINT "ontology_type_versions_object_type_id_ontology_object_types_id_fk" FOREIGN KEY ("object_type_id") REFERENCES "public"."ontology_object_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ontology_type_versions" ADD CONSTRAINT "ontology_type_versions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ontology_version_unique" ON "ontology_type_versions" USING btree ("object_type_id","version");--> statement-breakpoint
CREATE INDEX "ontology_version_org_idx" ON "ontology_type_versions" USING btree ("organization_id");
