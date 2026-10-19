import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        const adminUser = await pool.query("SELECT id, default_org_id FROM users WHERE username = 'admin'");
        const orgId = adminUser.rows[0].default_org_id;
        console.log(`Checking Org ID: ${orgId}`);

        const execs = await pool.query("SELECT id, pipeline_id, status, started_at FROM pipeline_executions WHERE organization_id = $1", [orgId]);
        console.log(`Pipeline Executions in DB for Org: ${execs.rowCount}`);
        execs.rows.forEach((r: any) => console.log(`  ID: ${r.id} | Pipeline: ${r.pipeline_id} | Status: ${r.status} | Started: ${r.started_at}`));

    } finally {
        await pool.end();
    }
}
main();
