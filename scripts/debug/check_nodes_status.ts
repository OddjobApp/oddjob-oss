import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        const res = await pool.query('SELECT id, name, label, verification_status, organization_id FROM knowledge_nodes');
        console.log('Nodes in DB:', res.rowCount);
        res.rows.forEach((r: any) => console.log(`  ID: ${r.id} | Name: ${r.name} | Label: ${r.label} | Status: ${r.verification_status} | Org: ${r.organization_id}`));

        const edges = await pool.query('SELECT id, source_id, target_id, relation FROM knowledge_edges');
        console.log('\nEdges in DB:', edges.rowCount);
        edges.rows.forEach((r: any) => console.log(`  ID: ${r.id} | ${r.source_id} --[${r.relation}]--> ${r.target_id}`));

    } finally {
        await pool.end();
    }
}
main();
