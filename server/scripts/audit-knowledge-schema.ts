import 'dotenv/config';
import pg from 'pg';

async function main() {
    console.log("Auditing knowledge tables for mission_id column...");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const tables = ['knowledge_nodes', 'knowledge_edges', 'knowledge_topics', 'knowledge_documents', 'knowledge_document_extractions', 'extraction_batches', 'graph_schema_defs', 'pipeline_step_executions', 'pipeline_executions', 'mission_runs'];
    const columns = ['mission_id', 'sleep_until', 'organization_id'];

    try {
        for (const table of tables) {
            for (const column of columns) {
                const res = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = '${table}' AND column_name = '${column}'`);
                if (res.rows.length > 0) {
                    console.log(`✅ Table '${table}' has ${column} column.`);
                } else {
                    // Only log if it's supposed to have it (check Drizzle schema mentally)
                    // We know knowledge_* should have mission_id
                    // We know pipeline_step_executions should have both
                    // We know pipeline_executions should have mission_id
                    if ((table === 'pipeline_step_executions' && (column === 'sleep_until' || column === 'mission_id')) ||
                        (table === 'pipeline_executions' && column === 'mission_id') ||
                        (table === 'mission_runs' && column === 'organization_id') ||
                        (table.startsWith('knowledge') && column === 'mission_id')) {
                        console.log(`❌ Table '${table}' is MISSING ${column} column!`);
                    }
                }
            }
        }
    } catch (e) {
        console.error("Audit Failed:", e);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

main();

