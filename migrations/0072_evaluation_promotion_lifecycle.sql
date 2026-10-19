CREATE TABLE IF NOT EXISTS "evaluation_promotions" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL,
  "test_set_id" integer NOT NULL,
  "candidate_run_id" integer NOT NULL,
  "baseline_run_id" integer,
  "assessment" jsonb NOT NULL,
  "reason" text,
  "promoted_by" text NOT NULL,
  "promoted_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "evaluation_promotions" ADD CONSTRAINT "evaluation_promotions_organization_id_orgs_org_id_fk"
 FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "evaluation_promotions" ADD CONSTRAINT "evaluation_promotions_test_set_id_evaluation_test_sets_id_fk"
 FOREIGN KEY ("test_set_id") REFERENCES "public"."evaluation_test_sets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "evaluation_promotions" ADD CONSTRAINT "evaluation_promotions_candidate_run_id_evaluation_runs_id_fk"
 FOREIGN KEY ("candidate_run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "evaluation_promotions" ADD CONSTRAINT "evaluation_promotions_baseline_run_id_evaluation_runs_id_fk"
 FOREIGN KEY ("baseline_run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "evaluation_promotions_org_set_idx"
  ON "evaluation_promotions" USING btree ("organization_id", "test_set_id");
CREATE INDEX IF NOT EXISTS "evaluation_promotions_candidate_idx"
  ON "evaluation_promotions" USING btree ("candidate_run_id");
