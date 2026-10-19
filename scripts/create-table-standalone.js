
import pg from 'pg';
const { Pool } = pg;

async function run() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.error("DATABASE_URL not set");
        process.exit(1);
    }

    const pool = new Pool({ connectionString: databaseUrl });
    console.log("Connecting to database...");

    try {
        const client = await pool.connect();
        console.log("Connected. Creating table...");

        await client.query(`
            CREATE TABLE IF NOT EXISTS "system_dependencies" (
                "id" serial PRIMARY KEY,
                "name" text NOT NULL,
                "version" text NOT NULL,
                "license" text,
                "feature" text,
                "security_alerts_count" integer DEFAULT 0 NOT NULL,
                "vulnerability_details" jsonb DEFAULT '[]'::jsonb,
                "last_synced_at" timestamp DEFAULT now() NOT NULL,
                "organization_id" integer
            )
        `);

        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "system_dep_name_unique" ON "system_dependencies" ("name")
        `);

        console.log("Table and index created successfully");
        client.release();
    } catch (err) {
        console.error("Operation failed:", err);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

run();
