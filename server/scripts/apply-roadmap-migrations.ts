import { db } from "../database_service.js";
import { sql } from "drizzle-orm";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("RoadmapMigrations");

async function apply() {
    logger.info("Applying roadmap SQL migrations...");

    // 1. Blueprints Table
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "blueprints" (
            "id" serial PRIMARY KEY NOT NULL,
            "slug" varchar(120) NOT NULL,
            "name" varchar(120) NOT NULL,
            "description" text,
            "version" varchar(20) DEFAULT '1.0.0' NOT NULL,
            "base_path" text,
            "manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
            "config_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
            "is_public" boolean DEFAULT true NOT NULL,
            "category" varchar(50) DEFAULT 'web_app' NOT NULL,
            "tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
            "created_at" timestamp DEFAULT now() NOT NULL,
            "updated_at" timestamp DEFAULT now() NOT NULL,
            CONSTRAINT "blueprint_slug_unq" UNIQUE("slug")
        );
    `);
    logger.info("✅ Blueprints table verified.");

    // 2. Rescue Sessions Culprit
    await db.execute(sql`
        ALTER TABLE "rescue_sessions" ADD COLUMN IF NOT EXISTS "culprit_node_id" integer;
    `);
    try {
        await db.execute(sql`
            ALTER TABLE "rescue_sessions" 
            ADD CONSTRAINT "rescue_sessions_culprit_node_id_knowledge_nodes_id_fk" 
            FOREIGN KEY ("culprit_node_id") 
            REFERENCES "knowledge_nodes"("id") ON DELETE set null;
        `);
    } catch (e) {
        logger.info("Constraint rescue_sessions_culprit_node_id_knowledge_nodes_id_fk probably already exists.");
    }
    logger.info("✅ Rescue sessions culprit column verified.");

    // 3. Dataset Items Knowledge Node
    await db.execute(sql`
        ALTER TABLE "dataset_items" ADD COLUMN IF NOT EXISTS "knowledge_node_id" integer;
    `);
    try {
        await db.execute(sql`
            ALTER TABLE "dataset_items" 
            ADD CONSTRAINT "dataset_items_knowledge_node_id_knowledge_nodes_id_fk" 
            FOREIGN KEY ("knowledge_node_id") 
            REFERENCES "knowledge_nodes"("id") ON DELETE set null;
        `);
    } catch (e) {
        logger.info("Constraint dataset_items_knowledge_node_id_knowledge_nodes_id_fk probably already exists.");
    }
    logger.info("✅ Dataset items knowledge node column verified.");

    logger.info("Roadmap migrations complete.");
    process.exit(0);
}

apply().catch(err => {
    logger.error("Migrations failed", err);
    process.exit(1);
});
