CREATE TABLE IF NOT EXISTS "knowledge_pack_source_monitors" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE cascade,
  "source_id" integer NOT NULL REFERENCES "knowledge_pack_sources"("id") ON DELETE cascade,
  "enabled" boolean DEFAULT true NOT NULL,
  "check_interval_hours" integer DEFAULT 24 NOT NULL,
  "trusted_hosts" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "owner_user_id" text NOT NULL,
  "escalation_hours" integer DEFAULT 48 NOT NULL,
  "next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_run_at" timestamp with time zone,
  "last_status" varchar(24),
  "last_error" text,
  "last_escalated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_pack_source_monitors_unq" ON "knowledge_pack_source_monitors" ("organization_id", "source_id");
CREATE INDEX IF NOT EXISTS "knowledge_pack_source_monitors_due_idx" ON "knowledge_pack_source_monitors" ("enabled", "next_run_at");

CREATE TABLE IF NOT EXISTS "knowledge_pack_monitor_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "monitor_id" integer NOT NULL REFERENCES "knowledge_pack_source_monitors"("id") ON DELETE cascade,
  "status" varchar(24) NOT NULL,
  "observed_hash" text,
  "changed" boolean,
  "candidate_id" integer REFERENCES "knowledge_pack_change_candidates"("id") ON DELETE set null,
  "error" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "knowledge_pack_monitor_runs_idx" ON "knowledge_pack_monitor_runs" ("monitor_id", "started_at");
