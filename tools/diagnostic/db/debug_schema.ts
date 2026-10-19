
import { db } from "./server/db.js";
import { sql } from "drizzle-orm";

async function run() {
    try {
        const columns = await db.execute(sql`
            SELECT column_name, is_nullable, column_default 
            FROM information_schema.columns 
            WHERE table_name = 'hil_forms'
        `);
        console.log("COLUMNS:");
        console.log(JSON.stringify(columns.rows, null, 2));

        const constraints = await db.execute(sql`
            SELECT conname, pg_get_constraintdef(oid) 
            FROM pg_constraint 
            WHERE conrelid = 'hil_forms'::regclass
        `);
        console.log("CONSTRAINTS:");
        console.log(JSON.stringify(constraints.rows, null, 2));
    } catch (err) {
        console.error(err);
    }
    process.exit(0);
}
run();
