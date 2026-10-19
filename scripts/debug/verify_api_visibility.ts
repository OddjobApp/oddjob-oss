import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        // Mimic getUserOrgContext for admin
        const adminUser = await pool.query("SELECT id, default_org_id FROM users WHERE username = 'admin'");
        const orgId = adminUser.rows[0].default_org_id;
        console.log(`Admin Current Org Context: ${orgId}`);

        // Mimic API query
        const res = await pool.query("SELECT id, name, label, verification_status FROM knowledge_nodes WHERE organization_id = $1 AND verification_status = 'verified'", [orgId]);
        console.log(`Verified Nodes for Admin: ${res.rowCount}`);
        res.rows.forEach((r: any) => console.log(`  - ${r.name} (${r.label})`));

    } finally {
        await pool.end();
    }
}
main();
