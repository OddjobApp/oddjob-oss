CREATE TABLE "capability_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"proposal_key" text NOT NULL,
	"proposed_capability_id" text NOT NULL,
	"classification" text NOT NULL,
	"title" text NOT NULL,
	"rationale" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"similar_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_manifest" jsonb,
	"promotion_result" jsonb,
	"created_by" text NOT NULL,
	"reviewed_by" text,
	"review_note" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capability_proposals" ADD CONSTRAINT "capability_proposals_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capability_proposals_org_key_unique" ON "capability_proposals" USING btree ("organization_id","proposal_key");--> statement-breakpoint
CREATE INDEX "capability_proposals_org_status_idx" ON "capability_proposals" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "capability_proposals_capability_idx" ON "capability_proposals" USING btree ("proposed_capability_id");