import "dotenv/config";
import pg from 'pg';

async function check() {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    const nodeRes = await pool.query("SELECT count(*) FROM knowledge_nodes");
    const edgeRes = await pool.query("SELECT count(*) FROM knowledge_edges");
    const extractRes = await pool.query("SELECT status, count(*) FROM knowledge_document_extractions GROUP BY status");

    console.log("Graph Stats:");
    console.log(`- Nodes: ${nodeRes.rows[0].count}`);
    console.log(`- Edges: ${edgeRes.rows[0].count}`);
    console.log("\nExtraction Statuses:");
    console.log(JSON.stringify(extractRes.rows, null, 2));

    await pool.end();
    process.exit(0);
}

check().catch(console.error);
