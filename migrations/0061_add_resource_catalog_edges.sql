CREATE TABLE "resource_edges" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"relation_type" text NOT NULL,
	"label" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resource_edges" ADD CONSTRAINT "resource_edges_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "resource_edges_source_idx" ON "resource_edges" USING btree ("source_type","source_id");
--> statement-breakpoint
CREATE INDEX "resource_edges_target_idx" ON "resource_edges" USING btree ("target_type","target_id");
--> statement-breakpoint
CREATE INDEX "resource_edges_org_idx" ON "resource_edges" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "resource_edges_org_relation_unique" ON "resource_edges" USING btree ("organization_id","source_type","source_id","relation_type","target_type","target_id");
