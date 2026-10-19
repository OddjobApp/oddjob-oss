ALTER TABLE "evaluation_test_sets" ADD COLUMN IF NOT EXISTS "mission_id" integer;
DO $$ BEGIN
ALTER TABLE "evaluation_test_sets" ADD CONSTRAINT "evaluation_test_sets_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
ALTER TABLE "evaluation_test_cases" ADD COLUMN IF NOT EXISTS "source_mission_run_id" integer;
DO $$ BEGIN
ALTER TABLE "evaluation_test_cases" ADD CONSTRAINT "evaluation_test_cases_source_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("source_mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS "evaluation_test_sets_mission_idx" ON "evaluation_test_sets" USING btree ("mission_id");
CREATE INDEX IF NOT EXISTS "evaluation_test_cases_source_run_idx" ON "evaluation_test_cases" USING btree ("source_mission_run_id");
