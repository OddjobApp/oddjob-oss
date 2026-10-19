import { db } from "../../server/database_service.js";
import { sql } from "drizzle-orm";

async function repair() {
    console.log("Starting Database Incident Resolution...");

    const queries = [
        // 1. Saved Queries & Templates
        `CREATE TABLE IF NOT EXISTS "query_templates" (
            "id" serial PRIMARY KEY NOT NULL,
            "name" text NOT NULL,
            "description" text,
            "category" text DEFAULT 'custom',
            "query_structure" jsonb NOT NULL,
            "cypher_template" text,
            "parameters" jsonb DEFAULT '[]'::jsonb,
            "is_public" boolean DEFAULT false,
            "organization_id" integer,
            "created_by" text,
            "created_at" timestamp DEFAULT now() NOT NULL,
            "updated_at" timestamp DEFAULT now() NOT NULL
        );`,
        `CREATE INDEX IF NOT EXISTS "query_templates_org_idx" ON "query_templates" ("organization_id");`,

        `CREATE TABLE IF NOT EXISTS "saved_queries" (
            "id" serial PRIMARY KEY NOT NULL,
            "name" text NOT NULL,
            "description" text,
            "query_structure" jsonb NOT NULL,
            "cypher_query" text,
            "organization_id" integer,
            "created_by" text,
            "last_run_at" timestamp,
            "run_count" integer DEFAULT 0,
            "created_at" timestamp DEFAULT now() NOT NULL,
            "updated_at" timestamp DEFAULT now() NOT NULL
        );`,
        `CREATE INDEX IF NOT EXISTS "saved_queries_org_idx" ON "saved_queries" ("organization_id");`,

        `CREATE TABLE IF NOT EXISTS "knowledge_topics" (
            "id" serial PRIMARY KEY NOT NULL,
            "name" text NOT NULL,
            "description" text,
            "parent_topic_id" integer,
            "organization_id" integer,
            "mission_id" integer,
            "created_by" text,
            "created_at" timestamp DEFAULT now() NOT NULL,
            "updated_at" timestamp DEFAULT now() NOT NULL
        );`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_topics_org_name_unique" ON "knowledge_topics" ("organization_id", "name");`,

        `CREATE TABLE IF NOT EXISTS "knowledge_documents" (
            "id" serial PRIMARY KEY NOT NULL,
            "title" text NOT NULL,
            "summary" text,
            "source_type" text DEFAULT 'upload' NOT NULL,
            "content_type" text,
            "file_size" integer,
            "file_data" text,
            "url" text,
            "text_content" text,
            "metadata" jsonb,
            "external_id" text,
            "organization_id" integer,
            "mission_id" integer,
            "dataset_item_id" integer,
            "integration_id" integer,
            "created_by" text,
            "qdrant_point_id" text,
            "created_at" timestamp DEFAULT now() NOT NULL,
            "updated_at" timestamp DEFAULT now() NOT NULL
        );`,
        // Document titles are namespaced per PROJECT, not per org (migration 0007).
        // Recreating the old org-wide index here would silently undo that namespacing
        // and break the (project_id, title) ON CONFLICT targets in the ingest paths.
        `ALTER TABLE "knowledge_documents" ADD COLUMN IF NOT EXISTS "project_id" integer;`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_docs_project_title_unique" ON "knowledge_documents" ("project_id", "title");`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_docs_org_title_unique_unassigned" ON "knowledge_documents" ("organization_id", "title") WHERE "project_id" IS NULL;`,

        // 2. Pipeline Baseline Columns
        `ALTER TABLE "pipelines" ADD COLUMN IF NOT EXISTS "baseline_run_id" integer;`,
        `ALTER TABLE "pipelines" ADD COLUMN IF NOT EXISTS "baseline_output" jsonb;`,
        `ALTER TABLE "pipelines" ADD COLUMN IF NOT EXISTS "self_healing_enabled" boolean DEFAULT false NOT NULL;`,

        // 3. Fix Foreign Keys
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'query_templates_organization_id_orgs_id_fk') THEN ALTER TABLE "query_templates" ADD CONSTRAINT "query_templates_organization_id_orgs_id_fk" FOREIGN KEY ("organization_id") REFERENCES "orgs"("org_id") ON DELETE CASCADE; END IF; END $$;`,
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_queries_organization_id_orgs_id_fk') THEN ALTER TABLE "saved_queries" ADD CONSTRAINT "saved_queries_organization_id_orgs_id_fk" FOREIGN KEY ("organization_id") REFERENCES "orgs"("org_id") ON DELETE CASCADE; END IF; END $$;`
    ];

    for (const q of queries) {
        try {
            console.log(`Executing: ${q.substring(0, 80)}...`);
            await db.execute(sql.raw(q));
            console.log("Success.");
        } catch (err: any) {
            console.error("Query failed:", err.message);
        }
    }

    console.log("Database Incident Resolution Complete.");
    process.exit(0);
}

repair();
