-- ACDD bi-directional capability & documentation sync — reconciler state.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "capability_sync_state" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer NOT NULL,
    "capability_id" text NOT NULL,
    "schema_version" integer DEFAULT 1 NOT NULL,
    "capability_version" text DEFAULT '1.0.0' NOT NULL,
    "signature_hash" text NOT NULL,
    "content_hash" text NOT NULL,
    "doc_hash" text,
    "last_source" text NOT NULL,
    "revision" integer DEFAULT 1 NOT NULL,
    "signature" jsonb NOT NULL,
    "manifest" jsonb,
    "risk_profile" text DEFAULT 'Low' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "capability_sync_state"
    ADD COLUMN IF NOT EXISTS "schema_version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "capability_sync_state"
    ADD COLUMN IF NOT EXISTS "capability_version" text DEFAULT '1.0.0' NOT NULL;
ALTER TABLE "capability_sync_state"
    ADD COLUMN IF NOT EXISTS "manifest" jsonb;

DO $$ BEGIN
    ALTER TABLE "capability_sync_state"
        ADD CONSTRAINT "capability_sync_state_organization_id_orgs_id_fk"
        FOREIGN KEY ("organization_id") REFERENCES "orgs"("org_id")
        ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "capability_sync_state_org_cap_idx"
    ON "capability_sync_state" ("organization_id", "capability_id");
CREATE INDEX IF NOT EXISTS "capability_sync_state_signature_idx"
    ON "capability_sync_state" ("signature_hash");

CREATE TABLE IF NOT EXISTS "capability_doc_file_state" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer NOT NULL,
    "doc_path" text NOT NULL,
    "file_hash" text NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
    ALTER TABLE "capability_doc_file_state"
        ADD CONSTRAINT "capability_doc_file_state_organization_id_orgs_id_fk"
        FOREIGN KEY ("organization_id") REFERENCES "orgs"("org_id")
        ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "capability_doc_file_state_org_path_idx"
    ON "capability_doc_file_state" ("organization_id", "doc_path");
