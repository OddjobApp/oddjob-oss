import { db } from "../../server/database_service.js";
import { sql } from "drizzle-orm";

async function checkTypes() {
    try {
        console.log("Checking custom types in database...");
        const types = await db.execute(sql`
            SELECT n.nspname as schema, t.typname as type 
            FROM pg_type t 
            LEFT JOIN pg_namespace n ON n.oid = t.typnamespace 
            WHERE (t.typrelidCodeType = 0 OR (SELECT c.relkind = 'c' FROM pg_class c WHERE c.oid = t.typrelidCodeType)) 
            AND NOT EXISTS (SELECT 1 FROM pg_type el WHERE el.oid = t.typelem AND el.typarray = t.oid)
            AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        `);
        console.log("Custom types:", JSON.stringify(types, null, 2));

        console.log("\nChecking tables and column types...");
        const columns = await db.execute(sql`
            SELECT table_name, column_name, data_type, udt_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public'
        `);
        console.log("Columns:", JSON.stringify(columns, null, 2));

    } catch (e) {
        console.error("Error checking types:", e);
    } finally {
        process.exit(0);
    }
}

checkTypes();
