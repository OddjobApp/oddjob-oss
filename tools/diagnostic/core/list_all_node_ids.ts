
import "dotenv/config";
import pg from 'pg';

async function listAllNodeIds() {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const res = await pool.query("SELECT id, label, organization_id, verification_status FROM knowledge_nodes ORDER BY id ASC");
        console.log(`Knowledge Nodes (${res.rows.length}):`);
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (error: any) {
        console.error("Error:", error.message);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

listAllNodeIds();
