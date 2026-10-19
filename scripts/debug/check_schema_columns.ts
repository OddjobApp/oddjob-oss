import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    // Get column names for key tables
    const tables = ['knowledge_documents', 'graph_schema_defs', 'knowledge_nodes', 'knowledge_edges', 'knowledge_document_extractions'];

    for (const table of tables) {
        const res = await pool.query(
            "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '" + table + "' ORDER BY ordinal_position"
        );
        console.log(`\n=== ${table} ===`);
        res.rows.forEach((r: any) => console.log(`  ${r.column_name}: ${r.data_type}`));
    }

    await pool.end();
}
main();
