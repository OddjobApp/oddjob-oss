import { db } from './server/db.js';
import { sql } from 'drizzle-orm';

async function check() {
    try {
        const res = await db.execute(sql`SELECT status, count(*) FROM knowledge_document_extractions GROUP BY status`);
        console.log('Extraction Statuses:');
        console.log(JSON.stringify(res.rows, null, 2));

        const recent = await db.execute(sql`SELECT id, status, document_id, error FROM knowledge_document_extractions ORDER BY id DESC LIMIT 5`);
        console.log('Recent Extractions:', JSON.stringify(recent.rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

check();
