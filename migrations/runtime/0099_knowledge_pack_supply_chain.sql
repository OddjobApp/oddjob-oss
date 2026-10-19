CREATE TABLE IF NOT EXISTS "knowledge_pack_sources" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE cascade,
  "pack_key" varchar(160) NOT NULL,
  "title" text NOT NULL,
  "source_uri" text NOT NULL,
  "authority" varchar(80) NOT NULL,
  "jurisdiction" varchar(80) NOT NULL,
  "effective_date" timestamp with time zone,
  "retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
  "content_hash" text NOT NULL,
  "content_snapshot" text NOT NULL,
  "status" varchar(24) DEFAULT 'acquired' NOT NULL,
  "acquired_by" text NOT NULL,
  "verified_by" text,
  "verified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "knowledge_pack_sources_org_pack_idx" ON "knowledge_pack_sources" ("organization_id", "pack_key");

CREATE TABLE IF NOT EXISTS "knowledge_pack_source_links" (
  "id" serial PRIMARY KEY NOT NULL,
  "knowledge_pack_id" integer NOT NULL REFERENCES "knowledge_packs"("id") ON DELETE cascade,
  "source_id" integer NOT NULL REFERENCES "knowledge_pack_sources"("id") ON DELETE restrict,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_pack_source_links_unq" ON "knowledge_pack_source_links" ("knowledge_pack_id", "source_id");

CREATE TABLE IF NOT EXISTS "knowledge_pack_attestations" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE cascade,
  "knowledge_pack_id" integer NOT NULL REFERENCES "knowledge_packs"("id") ON DELETE cascade,
  "attestation_type" varchar(32) NOT NULL,
  "decision" varchar(24) NOT NULL,
  "attested_by" text NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_pack_attestations_unq" ON "knowledge_pack_attestations" ("organization_id", "knowledge_pack_id", "attestation_type", "attested_by");
