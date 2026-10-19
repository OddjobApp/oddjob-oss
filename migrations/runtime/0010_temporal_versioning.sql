-- Temporal Versioning Tables
--
-- knowledge_node_versions: Records historical snapshots of knowledge node states
-- with timestamps, actor identifiers, and causal annotations. Supports point-in-time
-- queries, range queries, and FIFO pruning (max 100 versions per node).
--
-- knowledge_edge_versions: Records edge creation, modification, or deletion with
-- source/target node identifiers, relation type, weight, timestamp, and change type.
-- Supports diff queries with cursor-based pagination.

CREATE TABLE "knowledge_node_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"previous_state" jsonb NOT NULL,
	"new_state" jsonb NOT NULL,
	"change_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"causal_annotation" text DEFAULT 'unspecified' NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_edge_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"edge_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"source_id" integer NOT NULL,
	"target_id" integer NOT NULL,
	"relation" text NOT NULL,
	"weight" integer,
	"change_type" text NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_node_versions" ADD CONSTRAINT "knowledge_node_versions_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_node_versions" ADD CONSTRAINT "knowledge_node_versions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edge_versions" ADD CONSTRAINT "knowledge_edge_versions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "node_version_node_idx" ON "knowledge_node_versions" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "node_version_ts_idx" ON "knowledge_node_versions" USING btree ("node_id","timestamp");--> statement-breakpoint
CREATE INDEX "node_version_org_idx" ON "knowledge_node_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "edge_version_edge_idx" ON "knowledge_edge_versions" USING btree ("edge_id");--> statement-breakpoint
CREATE INDEX "edge_version_ts_idx" ON "knowledge_edge_versions" USING btree ("organization_id","timestamp");--> statement-breakpoint
CREATE INDEX "edge_version_org_idx" ON "knowledge_edge_versions" USING btree ("organization_id");
