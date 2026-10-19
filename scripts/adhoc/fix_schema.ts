import { db } from "../../server/database_service.js";
import { sql } from "drizzle-orm";

async function fix() {
    console.log("Upgrading integration_logs and fixing saas_connectors...");
    const queries = [
        // Fix saas_connectors primary key if missing
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saas_connectors_pkey') THEN ALTER TABLE saas_connectors ADD PRIMARY KEY (id); END IF; END $$;`,

        // Upgrade integration_logs
        `ALTER TABLE integration_logs ADD COLUMN IF NOT EXISTS rate_limit_limit integer;`,
        `ALTER TABLE integration_logs ADD COLUMN IF NOT EXISTS rate_limit_remaining integer;`,
        `ALTER TABLE integration_logs ADD COLUMN IF NOT EXISTS rate_limit_reset timestamp with time zone;`,
        `ALTER TABLE integration_logs ADD COLUMN IF NOT EXISTS model text;`,
        `ALTER TABLE integration_logs ADD COLUMN IF NOT EXISTS prompt_tokens integer;`,
        `ALTER TABLE integration_logs ADD COLUMN IF NOT EXISTS completion_tokens integer;`,
        `ALTER TABLE integration_logs ADD COLUMN IF NOT EXISTS cost_usd numeric(12,6);`,
        `ALTER TABLE integration_logs ADD COLUMN IF NOT EXISTS trace_id text;`,
        `ALTER TABLE integration_logs ADD COLUMN IF NOT EXISTS mission_id integer;`,
        `ALTER TABLE integration_logs ADD COLUMN IF NOT EXISTS is_priority boolean DEFAULT false;`,
        
        // Ensure created_at has timezone
        `ALTER TABLE integration_logs ALTER COLUMN created_at TYPE timestamp with time zone;`,

        // Fix prompt_performance_logs organization_id
        `ALTER TABLE prompt_performance_logs ADD COLUMN IF NOT EXISTS organization_id integer;`,
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_performance_logs_organization_id_orgs_id_fk') THEN ALTER TABLE prompt_performance_logs ADD CONSTRAINT prompt_performance_logs_organization_id_orgs_id_fk FOREIGN KEY (organization_id) REFERENCES orgs(org_id); END IF; END $$;`,

        // Drop the temporary table if it was created
        `DROP TABLE IF EXISTS integration_telemetry;`
    ];

    try {
        for (const q of queries) {
            console.log(`Executing: ${q.substring(0, 50)}...`);
            await db.execute(sql.raw(q));
        }
        console.log("Database schema synchronized.");
    } catch (err) {
        console.error("Fix failed:", err);
    } finally {
        process.exit(0);
    }
}

fix();
