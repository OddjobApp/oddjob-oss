/**
 * Get job by ID
 */
import 'dotenv/config';
import { db } from "../server/db/index.js";
import { sql } from 'drizzle-orm';

async function getJob() {
    const jobId = process.argv[2] || 27;
    const result = await db.execute(sql`
        SELECT id, name, type, config FROM jobs WHERE id = ${jobId}
    `);
    console.log('Job:', JSON.stringify(result.rows[0], null, 2));
    process.exit(0);
}
getJob();
