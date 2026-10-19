
import { pool } from "../database_service.js";

async function listTriggers() {
    console.log("Listing all triggers in the database...");
    const client = await pool.connect();
    try {
        const res = await client.query(`
            SELECT 
                trigger_name, 
                event_object_schema as schema_name,
                event_object_table as table_name, 
                event_manipulation as event, 
                action_timing as timing
            FROM information_schema.triggers
            ORDER BY table_name, trigger_name;
        `);
        console.table(res.rows);
    } catch (e) {
        console.error("Failed to list triggers:", e);
    } finally {
        client.release();
        process.exit();
    }
}

listTriggers();

