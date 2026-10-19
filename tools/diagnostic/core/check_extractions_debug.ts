
import "dotenv/config";
import pg from 'pg';

async function checkExtractions() {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const res = await pool.query(`
            SELECT status, sum(nodes_extracted) as total_nodes, count(*) as count 
            FROM knowledge_document_extractions 
            WHERE organization_id = 1
            GROUP BY status
        `);
        console.log("Extractions for KUS (Org 1):");
        console.log(JSON.stringify(res.rows, null, 2));

        const samples = await pool.query(`
            SELECT id, status, nodes_extracted, error 
            FROM knowledge_document_extractions 
            WHERE organization_id = 1 AND status = 'completed'
            LIMIT 5
        `);
        console.log("Sample completed extractions:");
        console.log(JSON.stringify(samples.rows, null, 2));

    } catch (error: any) {
        console.error("Error:", error.message);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

checkExtractions();
