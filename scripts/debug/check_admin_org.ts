import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        const adminUser = await pool.query("SELECT id, username FROM users WHERE username = 'admin'");
        if (adminUser.rows.length === 0) {
            console.log("Admin user not found");
            return;
        }
        const adminId = adminUser.rows[0].id;
        console.log(`Admin User ID: ${adminId}`);

        const userOrgs = await pool.query("SELECT * FROM user_orgs WHERE user_id = $1", [adminId]);
        console.log('Admin User Orgs:');
        userOrgs.rows.forEach((r: any) => console.log(`  Org ID: ${r.org_id} | Role: ${r.role}`));

        const nodesCount = await pool.query("SELECT organization_id, COUNT(*) FROM knowledge_nodes GROUP BY organization_id");
        console.log('\nNode counts by Org:');
        nodesCount.rows.forEach((r: any) => console.log(`  Org ID: ${r.organization_id} | Count: ${r.count}`));

    } finally {
        await pool.end();
    }
}
main();
