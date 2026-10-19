CREATE TABLE "knowledge_base_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"repository_id" text NOT NULL,
	"question_text" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"trigger_source" text NOT NULL,
	"context_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"proposed_answer" text,
	"answer_text" text,
	"answered_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "knowledge_base_questions" ADD CONSTRAINT "knowledge_base_questions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_kb_questions_org_repo_status" ON "knowledge_base_questions" USING btree ("organization_id","repository_id","status");