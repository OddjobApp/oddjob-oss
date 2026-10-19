import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function check() {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5433/oddjob' });
    try {
        console.log('Connecting to database...');
        const nodesRes = await pool.query('SELECT count(*) FROM knowledge_nodes');
        const edgesRes = await pool.query('SELECT count(*) FROM knowledge_edges');
        const docsRes = await pool.query('SELECT count(*) FROM knowledge_documents');
        const topicsRes = await pool.query('SELECT count(*) FROM knowledge_topics');
        const extractionsRes = await pool.query('SELECT status, count(*) FROM knowledge_document_extractions GROUP BY status');

        console.log('Knowledge Nodes Count:', nodesRes.rows[0].count);
        console.log('Knowledge Edges Count:', edgesRes.rows[0].count);
        console.log('Knowledge Documents Count:', docsRes.rows[0].count);
        console.log('Knowledge Topics Count:', topicsRes.rows[0].count);
        console.log('Extraction Statuses:', JSON.stringify(extractionsRes.rows, null, 2));

        const recentExtractions = await pool.query('SELECT id, status, document_id, error FROM knowledge_document_extractions ORDER BY id DESC LIMIT 5');
        console.log('Recent Extractions:', JSON.stringify(recentExtractions.rows, null, 2));

        const sampleRes = await pool.query('SELECT id, label, name FROM knowledge_nodes LIMIT 5');
        console.log('Sample nodes:', JSON.stringify(sampleRes.rows, null, 2));
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

check();
