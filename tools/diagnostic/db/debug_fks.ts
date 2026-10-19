
import { db } from "./server/db.js";
import { sql } from "drizzle-orm";

async function run() {
    try {
        const res = await db.execute(sql`
            SELECT
                tc.constraint_name, 
                tc.table_name, 
                kcu.column_name, 
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name 
            FROM 
                information_schema.table_constraints AS tc 
                JOIN information_schema.key_column_usage AS kcu
                  ON tc.constraint_name = kcu.constraint_name
                  AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name
                  AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name='hil_forms';
        `);
        console.log("FOREIGN KEYS:");
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error(err);
    }
    process.exit(0);
}
run();
