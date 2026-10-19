
import { pool } from "../database_service.js";

async function inspectSchema() {
    console.log("Inspecting database columns...");
    const client = await pool.connect();
    try {
        console.log("\n--- All Tables ---");
        const resTables = await client.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog')");
        console.log(JSON.stringify(resTables.rows, null, 2));

        console.log("\n--- Columns for table 'optimization_suggestions' ---");
        const resSug = await client.query("SELECT column_name, is_nullable, column_default, data_type FROM information_schema.columns WHERE table_name = 'optimization_suggestions' AND table_schema = 'public'");
        console.log(JSON.stringify(resSug.rows, null, 2));

        console.log("\n--- Constraints for 'jobs' ---");
        const resCons = await client.query("SELECT conname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' AND conrelid = 'jobs'::regclass");
        console.log(JSON.stringify(resCons.rows, null, 2));
    } catch (e) {
        console.error("Failed to inspect schema:", e);
    } finally {
        client.release();
        process.exit();
    }
}

inspectSchema();

