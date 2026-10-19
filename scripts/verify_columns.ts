import { db } from "../server/db/index.js";
import { sql } from 'drizzle-orm';

async function check() {
    try {
        const res = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'pipeline_step_executions'`);
        console.log('Columns in pipeline_step_executions:');
        console.log(res.rows.map((r: any) => r.column_name).join(', '));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

check();
