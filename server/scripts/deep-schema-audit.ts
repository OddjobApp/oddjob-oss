import 'dotenv/config';
import pg from 'pg';

async function main() {
    console.log("Deep auditing schemas for execution and mission tables...");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const tables = [
        'knowledge_nodes',
        'knowledge_edges',
        'knowledge_topics',
        'knowledge_documents',
        'knowledge_document_extractions',
        'extraction_batches',
        'graph_schema_defs',
        'pipeline_step_executions',
        'pipeline_executions',
        'mission_runs'
    ];

    try {
        for (const table of tables) {
            console.log(`--- Table: ${table} ---`);
            const res = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${table}'`);
            if (res.rows.length === 0) {
                console.log(`❌ Table '${table}' does not exist!`);
            } else {
                res.rows.forEach(r => {
                    console.log(`- ${r.column_name} (${r.data_type})`);
                });
            }
        }
    } catch (e) {
        console.error("Deep Audit Failed:", e);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

main();

