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

        const roles = await pool.query("SELECT * FROM admin_roles WHERE user_id = $1", [adminId]);
        console.log('Admin Roles:');
        roles.rows.forEach((r: any) => console.log(`  ID: ${r.id} | RoleType: ${r.role_type} | OrgID: ${r.organization_id}`));

    } finally {
        await pool.end();
    }
}
main();
