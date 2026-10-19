import "dotenv/config";
import pg from 'pg';
import { queueExtractionJob } from "../server/domain/knowledge/knowledge-queue.js";

async function requeue() {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    console.log("Finding queued extractions...");
    const res = await pool.query(
        "SELECT id, document_id, schema_id, organization_id FROM knowledge_document_extractions WHERE status = 'queued'"
    );

    console.log(`Found ${res.rows.length} records to requeue.`);

    let count = 0;
    for (const row of res.rows) {
        await queueExtractionJob({
            type: 'document',
            extractionId: row.id,
            documentId: row.document_id,
            schemaId: row.schema_id,
            organizationId: row.organization_id
        });
        count++;
        if (count % 50 === 0) {
            console.log(`Queued ${count}/${res.rows.length}...`);
        }
    }

    console.log("Requeueing completed.");
    await pool.end();
    process.exit(0);
}

requeue().catch(err => {
    console.error(err);
    process.exit(1);
});
