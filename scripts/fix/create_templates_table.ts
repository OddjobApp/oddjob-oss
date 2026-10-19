
import { pool } from "../../server/db/index.js";

async function main() {
    console.log("Creating pipeline_templates table...");
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pipeline_templates (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                category TEXT DEFAULT 'general',
                icon TEXT,
                config JSONB NOT NULL,
                parameter_schema JSONB,
                is_featured BOOLEAN DEFAULT false,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                created_by TEXT
            );
        `);
        console.log("Created pipeline_templates.");

        console.log("Creating schema_mapping_templates table...");
        await pool.query(`
            CREATE TABLE IF NOT EXISTS schema_mapping_templates (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                mapping_config JSONB NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                organization_id INTEGER NOT NULL
            );
        `);
        console.log("Created schema_mapping_templates.");

        console.log("Tables creation attempt finished.");
    } catch (e) {
        console.error("Error creating tables:", e);
    }
    process.exit(0);
}

main();
