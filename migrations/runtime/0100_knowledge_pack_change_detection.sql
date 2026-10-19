ALTER TABLE "knowledge_pack_sources" ADD COLUMN IF NOT EXISTS "freshness_days" integer DEFAULT 90 NOT NULL;
ALTER TABLE "knowledge_pack_sources" ADD COLUMN IF NOT EXISTS "last_checked_at" timestamp with time zone;
ALTER TABLE "knowledge_pack_sources" ADD COLUMN IF NOT EXISTS "next_check_at" timestamp with time zone;
ALTER TABLE "knowledge_pack_sources" ADD COLUMN IF NOT EXISTS "stale_at" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "knowledge_pack_source_observations" (
  "id" serial PRIMARY KEY NOT NULL,
  "source_id" integer NOT NULL REFERENCES "knowledge_pack_sources"("id") ON DELETE cascade,
  "observed_hash" text NOT NULL,
  "content_snapshot" text NOT NULL,
  "effective_date" timestamp with time zone,
  "changed" boolean NOT NULL,
  "checked_by" text NOT NULL,
  "checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "knowledge_pack_source_observations_idx" ON "knowledge_pack_source_observations" ("source_id", "checked_at");

CREATE TABLE IF NOT EXISTS "knowledge_pack_change_candidates" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE cascade,
  "source_id" integer NOT NULL REFERENCES "knowledge_pack_sources"("id") ON DELETE cascade,
  "observation_id" integer NOT NULL REFERENCES "knowledge_pack_source_observations"("id") ON DELETE cascade,
  "previous_hash" text NOT NULL,
  "observed_hash" text NOT NULL,
  "status" varchar(24) DEFAULT 'open' NOT NULL,
  "reviewed_by" text,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "knowledge_pack_change_candidates_org_status_idx" ON "knowledge_pack_change_candidates" ("organization_id", "status");
