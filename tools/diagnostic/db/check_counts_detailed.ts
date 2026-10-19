
import "dotenv/config";
import pg from 'pg';

async function checkCountsDetailed() {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const counts = await pool.query(`
            SELECT 'orgs' as table_name, count(*) FROM orgs UNION ALL
            SELECT 'knowledge_nodes', count(*) FROM knowledge_nodes UNION ALL
            SELECT 'knowledge_edges', count(*) FROM knowledge_edges UNION ALL
            SELECT 'dataset_items', count(*) FROM dataset_items UNION ALL
            SELECT 'knowledge_documents', count(*) FROM knowledge_documents UNION ALL
            SELECT 'knowledge_document_extractions', count(*) FROM knowledge_document_extractions
        `);
        console.log("Global Counts:");
        console.log(JSON.stringify(counts.rows, null, 2));

        const orgCounts = await pool.query(`
            SELECT organization_id, count(*) FROM knowledge_nodes GROUP BY organization_id
        `);
        console.log("Nodes by Org:");
        console.log(JSON.stringify(orgCounts.rows, null, 2));

    } catch (error: any) {
        console.error("Error:", error.message);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

checkCountsDetailed();
