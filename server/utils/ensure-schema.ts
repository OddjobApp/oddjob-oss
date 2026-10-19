import { db } from "../database_service.js";
import { sql } from "drizzle-orm";
import { createLogger } from "./logger.js";

const logger = createLogger("SchemaStabilizer");

/**
 * Ensures that the database schema is aligned with critical application requirements.
 * This is a "warm-up" step to catch common delta issues (e.g. missing columns) 
 * that might have been skipped during migrations.
 */
export async function ensureSchemaIntegrity() {
    logger.info("Verifying schema integrity...");

    try {
        // 1. Check for 'is_installed' in 'skills' table
        await db.execute(sql`
            ALTER TABLE IF EXISTS skills 
            ADD COLUMN IF NOT EXISTS is_installed boolean NOT NULL DEFAULT true
        `);
        await db.execute(sql`
            ALTER TABLE IF EXISTS skills
            ADD COLUMN IF NOT EXISTS organization_id integer
        `);
        logger.info("Checked 'skills' foundational columns presence.");

        // 2. Check for 'app_instances' table
        // We do this via raw SQL to ensure it exists before the server starts using it
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "app_instances" (
                "id" serial PRIMARY KEY NOT NULL,
                "deployment_id" integer NOT NULL,
                "container_id" text NOT NULL,
                "port" integer NOT NULL,
                "status" varchar(20) DEFAULT 'starting' NOT NULL,
                "last_heartbeat_at" timestamp DEFAULT now() NOT NULL,
                "created_at" timestamp DEFAULT now() NOT NULL,
                "updated_at" timestamp DEFAULT now() NOT NULL
            )
        `);
        logger.info("Checked 'app_instances' table presence.");

        // 3. Ensure 'apps' has stitch_project_id column (added for Stitch integration)
        await db.execute(sql`
            ALTER TABLE IF EXISTS apps
            ADD COLUMN IF NOT EXISTS stitch_project_id text
        `);
        logger.info("Checked 'apps.stitch_project_id' presence.");

        // 4. Ensure 'agent_deployments' has allowed_tools column (tool scoping for public deployments)
        await db.execute(sql`
            ALTER TABLE IF EXISTS agent_deployments
            ADD COLUMN IF NOT EXISTS allowed_tools text[]
        `);
        logger.info("Checked 'agent_deployments.allowed_tools' presence.");

        // 5. Ensure 'app_instances' has indices
        await db.execute(sql`CREATE INDEX IF NOT EXISTS "app_instances_deployment_idx" ON "app_instances" ("deployment_id")`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS "app_instances_status_idx" ON "app_instances" ("status")`);

        // 6. Ensure 'app_deployments' has knowledge/agent scoping columns
        await db.execute(sql`ALTER TABLE IF EXISTS app_deployments ADD COLUMN IF NOT EXISTS allowed_agent_ids INTEGER[] DEFAULT ARRAY[]::integer[]`);
        await db.execute(sql`ALTER TABLE IF EXISTS app_deployments ADD COLUMN IF NOT EXISTS allowed_topic_ids INTEGER[] DEFAULT ARRAY[]::integer[]`);
        await db.execute(sql`ALTER TABLE IF EXISTS app_deployments ADD COLUMN IF NOT EXISTS allowed_dataset_ids INTEGER[] DEFAULT ARRAY[]::integer[]`);
        await db.execute(sql`ALTER TABLE IF EXISTS app_deployments ADD COLUMN IF NOT EXISTS allowed_pipeline_ids INTEGER[] DEFAULT ARRAY[]::integer[]`);
        await db.execute(sql`ALTER TABLE IF EXISTS app_deployments ADD COLUMN IF NOT EXISTS default_collections TEXT[] DEFAULT ARRAY[]::text[]`);

        logger.info("✅ Schema stabilization complete.");
    } catch (error) {
        logger.error("❌ Schema stabilization failed:", error);
        // We don't throw here to avoid blocking server start, but it will be logged
    }
}
