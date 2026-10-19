
import 'dotenv/config';
import pg from 'pg';

async function main() {
    console.log("--- PERFORMANCE INFRASTRUCTURE INJECTION ---");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    try {
        console.log("Adding GIN index for JSONB search on knowledge_nodes.data...");
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_data_gin ON knowledge_nodes USING gin (data);`);

        console.log("Adding B-Tree index for name prefix search...");
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_name_btree ON knowledge_nodes (name);`);

        console.log("Adding B-Tree index for label filtering...");
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_label_btree ON knowledge_nodes (label);`);

        console.log("Adding multi-column index for Org isolation...");
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_org_id ON knowledge_nodes (organization_id);`);

        console.log("Performance indexes successfully injected into 10GB dataset!");
    } catch (e: any) {
        console.error("Index injection failed:", e.message);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

main();

