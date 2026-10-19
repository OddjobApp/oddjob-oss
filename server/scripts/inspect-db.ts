
import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function inspect() {
    const res = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'forensic_event_log'`);
    console.log(JSON.stringify(res.rows, null, 2));
}

inspect().catch(console.error).finally(() => process.exit(0));

