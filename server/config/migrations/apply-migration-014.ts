import { db } from "../../database_service.js";
import { sql } from "drizzle-orm";

async function applyMigration014() {
    console.log("🚀 Applying Migration 014: component_index & assembly_manifests...");

    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "component_index" (
            "id" SERIAL PRIMARY KEY,
            "organization_id" INTEGER REFERENCES "orgs"("org_id"),
            "component_name" TEXT NOT NULL UNIQUE,
            "component_category" TEXT NOT NULL,
            "export_type" TEXT DEFAULT 'named' NOT NULL,
            "package_source" TEXT NOT NULL,
            "import_path" TEXT NOT NULL,
            "prop_schema" JSONB DEFAULT '{}'::jsonb,
            "dependencies" JSONB DEFAULT '[]'::jsonb,
            "code_snippet" TEXT NOT NULL,
            "blueprint_template" TEXT,
            "effectiveness_score" NUMERIC(3, 2) DEFAULT '5.00',
            "verification_success_rate" NUMERIC(5, 2) DEFAULT '100.00',
            "total_assemble_count" INTEGER DEFAULT 0,
            "is_approved_for_assembly" BOOLEAN DEFAULT true,
            "created_at" TIMESTAMP DEFAULT NOW() NOT NULL,
            "updated_at" TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE INDEX IF NOT EXISTS "comp_idx_name_idx" ON "component_index" ("component_name");
        CREATE INDEX IF NOT EXISTS "comp_idx_category_idx" ON "component_index" ("component_category");
        CREATE INDEX IF NOT EXISTS "comp_idx_org_idx" ON "component_index" ("organization_id");
        CREATE INDEX IF NOT EXISTS "comp_idx_effectiveness_idx" ON "component_index" ("effectiveness_score");

        CREATE TABLE IF NOT EXISTS "assembly_manifests" (
            "id" SERIAL PRIMARY KEY,
            "organization_id" INTEGER REFERENCES "orgs"("org_id") NOT NULL,
            "assembly_id" TEXT NOT NULL UNIQUE,
            "intent" TEXT NOT NULL,
            "author_agent" TEXT DEFAULT 'antigravity-supervisor-v1' NOT NULL,
            "manifest_yaml" TEXT NOT NULL,
            "spec_payload" JSONB NOT NULL,
            "artifact_hashes" JSONB DEFAULT '{}'::jsonb,
            "build_status" TEXT DEFAULT 'pending' NOT NULL,
            "docker_image_tag" TEXT,
            "endpoint_url" TEXT,
            "latency_p95_ms" NUMERIC(7, 2),
            "created_at" TIMESTAMP DEFAULT NOW() NOT NULL,
            "updated_at" TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE INDEX IF NOT EXISTS "asm_manifest_org_idx" ON "assembly_manifests" ("organization_id");
        CREATE INDEX IF NOT EXISTS "asm_manifest_id_idx" ON "assembly_manifests" ("assembly_id");
        CREATE INDEX IF NOT EXISTS "asm_manifest_status_idx" ON "assembly_manifests" ("build_status");
    `);

    console.log("✅ Migration 014 applied successfully.");
}

applyMigration014().then(() => process.exit(0)).catch((err) => {
    console.error("❌ Migration 014 failed:", err);
    process.exit(1);
});
