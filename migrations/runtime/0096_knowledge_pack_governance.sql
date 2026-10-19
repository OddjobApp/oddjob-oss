CREATE TABLE IF NOT EXISTS "knowledge_packs" (
  "id" serial PRIMARY KEY NOT NULL,
  "pack_key" varchar(160) NOT NULL,
  "version" varchar(32) NOT NULL,
  "name" text NOT NULL,
  "publisher" text NOT NULL,
  "content_hash" text NOT NULL,
  "synthetic" boolean DEFAULT false NOT NULL,
  "manifest" jsonb NOT NULL,
  "status" varchar(24) DEFAULT 'published' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_packs_key_version_unq" ON "knowledge_packs" ("pack_key", "version");

CREATE TABLE IF NOT EXISTS "org_knowledge_pack_installations" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE cascade,
  "knowledge_pack_id" integer NOT NULL REFERENCES "knowledge_packs"("id") ON DELETE restrict,
  "status" varchar(24) DEFAULT 'staged' NOT NULL,
  "applicability_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "compiled_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "certified_by" text,
  "certified_at" timestamp with time zone,
  "activated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "org_knowledge_pack_installations_unq" ON "org_knowledge_pack_installations" ("organization_id", "knowledge_pack_id");
CREATE INDEX IF NOT EXISTS "org_knowledge_pack_installations_status_idx" ON "org_knowledge_pack_installations" ("organization_id", "status");

CREATE TABLE IF NOT EXISTS "governance_decision_evidence" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE cascade,
  "installation_id" integer REFERENCES "org_knowledge_pack_installations"("id") ON DELETE set null,
  "action_type" varchar(160) NOT NULL,
  "context_hash" text NOT NULL,
  "decision" varchar(32) NOT NULL,
  "applicable_controls" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "actor_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "governance_decision_evidence_org_time_idx" ON "governance_decision_evidence" ("organization_id", "created_at");
