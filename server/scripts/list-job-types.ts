
import { db } from '../database_service.js';
import { sql } from 'drizzle-orm';
import { forensicEventLog } from '../../shared/schema/observability.js';

async function listJobTypes() {
    try {
        const result = await db.execute(sql`SELECT DISTINCT job_type FROM forensic_event_log ORDER BY job_type`);
        console.log(JSON.stringify(result.rows, null, 2));
    } catch (error) {
        console.error('Error fetching job types:', error);
    } finally {
        process.exit(0);
    }
}

listJobTypes();

