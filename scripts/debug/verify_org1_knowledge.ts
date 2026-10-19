import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        const docs = await pool.query('SELECT COUNT(*) FROM knowledge_documents WHERE organization_id = 1');
        const topics = await pool.query('SELECT COUNT(*) FROM knowledge_topics WHERE organization_id = 1');
        const schemas = await pool.query('SELECT COUNT(*) FROM graph_schema_defs WHERE organization_id = 1');
        const extractions = await pool.query("SELECT COUNT(*) FROM knowledge_document_extractions WHERE organization_id = 1 AND status = 'pending'");

        console.log('✅ Knowledge Setup for Org 1 (Acme Corp):');
        console.log('  📄 Documents:', docs.rows[0].count);
        console.log('  📚 Topics:', topics.rows[0].count);
        console.log('  🧠 Schemas:', schemas.rows[0].count);
        console.log('  ⏳ Pending Extractions:', extractions.rows[0].count);

    } finally {
        await pool.end();
    }
}

main();
