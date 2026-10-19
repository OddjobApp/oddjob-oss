
import "dotenv/config";
import pg from 'pg';

async function checkKUSExtractions() {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const res = await pool.query(`
            SELECT id, document_id, nodes_extracted, edges_extracted, completed_at
            FROM knowledge_document_extractions 
            WHERE organization_id = 1 AND status = 'completed'
            ORDER BY completed_at DESC
            LIMIT 20
        `);
        console.log("Recent completed extractions for KUS:");
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (error: any) {
        console.error("Error:", error.message);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

checkKUSExtractions();
