
import "dotenv/config";
import { Pool } from "pg";

async function main() {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is not set");
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 1,
    });

    console.log("🛠️ Fixing Governance Schema (Direct PG Client)...");
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // 1. Create governor_policies table
        console.log("Creating 'governor_policies' table...");
        await client.query(`
            CREATE TABLE IF NOT EXISTS governor_policies (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                organization_id INTEGER REFERENCES orgs(id),
                type TEXT NOT NULL DEFAULT 'custom',
                is_active BOOLEAN NOT NULL DEFAULT true,
                created_by TEXT NOT NULL DEFAULT 'system',
                created_at TIMESTAMP NOT NULL DEFAULT now(),
                updated_at TIMESTAMP NOT NULL DEFAULT now()
            );
        `);

        // 2. Create governor_policy_rules table
        console.log("Creating 'governor_policy_rules' table...");
        await client.query(`
            CREATE TABLE IF NOT EXISTS governor_policy_rules (
                id SERIAL PRIMARY KEY,
                policy_id INTEGER NOT NULL REFERENCES governor_policies(id) ON DELETE CASCADE,
                type TEXT NOT NULL,
                configuration JSONB NOT NULL,
                is_enabled BOOLEAN NOT NULL DEFAULT true,
                created_at TIMESTAMP NOT NULL DEFAULT now()
            );
        `);

        // 3. Add governor_policy_id to jobs table
        console.log("Adding 'governor_policy_id' column to jobs table...");
        // Use separate query to check existence first to avoid error block issues
        const checkRes = await client.query("SELECT 1 FROM information_schema.columns WHERE table_name='jobs' AND column_name='governor_policy_id'");
        if (checkRes.rowCount === 0) {
            await client.query(`ALTER TABLE jobs ADD COLUMN governor_policy_id INTEGER REFERENCES governor_policies(id);`);
            await client.query(`CREATE INDEX IF NOT EXISTS jobs_governor_policy_idx ON jobs(governor_policy_id);`);
            console.log(" -> Added governor_policy_id column.");
        } else {
            console.log(" -> governor_policy_id already exists.");
        }

        // 4. Also add governor_settings column to jobs if missing
        console.log("Adding 'governor_settings' column to jobs table...");
        const checkSettings = await client.query("SELECT 1 FROM information_schema.columns WHERE table_name='jobs' AND column_name='governor_settings'");
        if (checkSettings.rowCount === 0) {
            await client.query(`ALTER TABLE jobs ADD COLUMN governor_settings JSONB;`);
            console.log(" -> Added governor_settings column.");
        } else {
            console.log(" -> governor_settings already exists.");
        }

        await client.query("COMMIT");
        console.log("✅ Governance schema fixed successfully.");

    } catch (err: any) {
        await client.query("ROLLBACK");
        console.error("❌ Failed to fix schema:", err);
    } finally {
        client.release();
        await pool.end();
    }
}

main();

