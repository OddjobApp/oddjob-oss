import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        // Check total jobs
        const totalJobs = await pool.query('SELECT COUNT(*) FROM jobs');
        console.log('Total Jobs in Database:', totalJobs.rows[0].count);

        // Check jobs by org
        const jobsByOrg = await pool.query('SELECT organization_id, COUNT(*) as count FROM jobs GROUP BY organization_id ORDER BY organization_id');
        console.log('\nJobs by Organization:');
        if (jobsByOrg.rows.length === 0) {
            console.log('  (no jobs found)');
        } else {
            jobsByOrg.rows.forEach((r: any) => {
                console.log(`  Org ${r.organization_id}: ${r.count} jobs`);
            });
        }

        // Check all orgs
        const orgs = await pool.query('SELECT id, name FROM orgs ORDER BY id');
        console.log('\nOrganizations:');
        orgs.rows.forEach((o: any) => {
            console.log(`  ID: ${o.id} | Name: ${o.name}`);
        });

        // Check if seed data exists
        const totalPipelines = await pool.query('SELECT COUNT(*) FROM pipelines');
        const totalUsers = await pool.query('SELECT COUNT(*) FROM users');

        console.log('\nDatabase Status:');
        console.log(`  Users: ${totalUsers.rows[0].count}`);
        console.log(`  Jobs: ${totalJobs.rows[0].count}`);
        console.log(`  Pipelines: ${totalPipelines.rows[0].count}`);

    } finally {
        await pool.end();
    }
}

main();
