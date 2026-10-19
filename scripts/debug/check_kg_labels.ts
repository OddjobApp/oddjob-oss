
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
            "SELECT id, name, label FROM knowledge_nodes WHERE organization_id = $1",
            [orgId]
        );
        console.log(`Nodes found: ${nodesRes.rowCount}`);

        const labels = [...new Set(nodesRes.rows.map((r: any) => r.label))];
        console.log("Unique labels found:", labels);

        console.log("Sample nodes:");
        nodesRes.rows.slice(0, 50).forEach(n => {
            console.log(`- [${n.label}] ${n.name} (ID: ${n.id})`);
        });

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

run();
