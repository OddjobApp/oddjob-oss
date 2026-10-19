
import "dotenv/config";
import pg from 'pg';

async function listAllNodesRaw() {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const res = await pool.query("SELECT * FROM knowledge_nodes LIMIT 100");
        console.log(`Total nodes in sample: ${res.rows.length}`);
        res.rows.forEach(node => {
            console.log(JSON.stringify(node));
        });
        
        const count = await pool.query("SELECT count(*) FROM knowledge_nodes");
        console.log(`Global node count: ${count.rows[0].count}`);
    } catch (error: any) {
        console.error("Error:", error.message);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

listAllNodesRaw();
