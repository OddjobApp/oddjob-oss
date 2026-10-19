-- 0145_saas_sync_links
--
-- Remote-record ↔ local-record link table for SaaS sync (first consumer:
-- QuickBooks). Rows record which remote object maps to which local mirror
-- record, the remote revision (SyncToken), and the direction the link was
-- created in — 'in' for sync-mirrored records, 'out' for approval-gated
-- writes pushed to the remote. Sync uses the links to upsert rather than
-- duplicate and to suppress echoes of our own approved writes.
--
-- Guarded so environments that already carry the shape (e.g. via db push)
-- are left unchanged.

CREATE TABLE IF NOT EXISTS "saas_sync_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"connector_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	"direction" text DEFAULT 'in' NOT NULL,
	"local_collection" text NOT NULL,
	"local_record_id" text NOT NULL,
	"remote_entity" text NOT NULL,
	"remote_id" text NOT NULL,
	"remote_sync_token" text,
	"remote_updated_at" timestamp with time zone,
	"local_hash" text,
	"last_sync_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
	ALTER TABLE "saas_sync_links" ADD CONSTRAINT "saas_sync_links_connector_id_saas_connectors_id_fk"
		FOREIGN KEY ("connector_id") REFERENCES "public"."saas_connectors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "saas_sync_links" ADD CONSTRAINT "saas_sync_links_org_id_orgs_id_fk"
		FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "saas_sync_link_remote_unq"
	ON "saas_sync_links" USING btree ("connector_id", "remote_entity", "remote_id");
CREATE UNIQUE INDEX IF NOT EXISTS "saas_sync_link_local_unq"
	ON "saas_sync_links" USING btree ("connector_id", "local_collection", "local_record_id");
CREATE INDEX IF NOT EXISTS "saas_sync_link_org_idx"
	ON "saas_sync_links" USING btree ("org_id");
