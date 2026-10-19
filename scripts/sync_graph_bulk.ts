import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL
});

async function runSync() {
    console.log("Starting Bulk Knowledge Graph Sync...");

    try {
        // 1. Get stats on documents per organization
        const orgStats = await pool.query('SELECT organization_id, count(*) FROM knowledge_documents GROUP BY organization_id ORDER BY count DESC LIMIT 1');
        console.log('Top Organization:', JSON.stringify(orgStats.rows, null, 2));

        const orgId = orgStats.rows.length > 0 ? orgStats.rows[0].organization_id : 1;
        console.log(`Auto-selected Organization ID: ${orgId}`);

        // 1. Get default schema
        const schemaRes = await pool.query('SELECT id, name FROM graph_schema_defs LIMIT 1');
        if (schemaRes.rows.length === 0) {
            console.error("No graph schema found.");
            process.exit(1);
        }
        const schema = schemaRes.rows[0];
        console.log(`Using Schema: ${schema.name} (ID: ${schema.id})`);

        // 2. Find integration documents
        const sourcesRes = await pool.query('SELECT DISTINCT source_type FROM knowledge_documents');
        console.log('Available source types:', sourcesRes.rows.map(r => r.source_type));

        const docsRes = await pool.query(
            'SELECT id, title, source_type FROM knowledge_documents WHERE organization_id = $1',
            [orgId]
        );
        const docs = docsRes.rows;
        console.log(`Found ${docs.length} integration documents.`);

        if (docs.length === 0) process.exit(0);

        let queuedCount = 0;
        for (const doc of docs) {
            // Check if extraction already exists
            const extractRes = await pool.query(
                "SELECT id FROM knowledge_document_extractions WHERE document_id = $1 AND schema_id = $2 AND status IN ('completed', 'processing', 'queued')",
                [doc.id, schema.id]
            );

            if (extractRes.rows.length > 0) continue;

            // Insert extraction record
            await pool.query(
                "INSERT INTO knowledge_document_extractions (document_id, schema_id, organization_id, status, priority, created_by, metadata, queued_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())",
                [doc.id, schema.id, orgId, 'queued', 0, 'system_sync', JSON.stringify({ source: 'bulk_sync_script' })]
            );

            queuedCount++;
            if (queuedCount % 50 === 0) {
                console.log(`Prepared ${queuedCount}/${docs.length} extraction records...`);
            }
        }

        console.log(`Successfully prepared ${queuedCount} extraction records in database.`);
        console.log("NOTE: This script only prepares the database records. The extraction worker service (npm run worker) must be running to process them.");
    } catch (error) {
        console.error("Sync failed:", error);
    } finally {
        await pool.end();
    }
}

runSync();
