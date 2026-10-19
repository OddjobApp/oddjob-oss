
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

async function run() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        const orgId = 2; // TechStart Inc
        console.log(`Checking knowledge graph nodes for Org ${orgId}...`);

        const nodesRes = await pool.query(
            "SELECT id, name, label, organization_id FROM knowledge_nodes WHERE organization_id = $1",
            [orgId]
        );
        console.log(`Nodes found: ${nodesRes.rowCount}`);
        if (nodesRes.rowCount && nodesRes.rowCount > 0) {
            console.log("Nodes:", nodesRes.rows);
        } else {
            console.log("No nodes found in knowledge graph for Org 2.");
        }

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

run();
