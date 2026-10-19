import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        // Just move the jobs directly
        console.log('📦 Moving jobs from Org 1 to Org 3...');
        const result = await pool.query('UPDATE jobs SET organization_id = 3 WHERE organization_id = 1');
        console.log(`✅ Moved ${result.rowCount} jobs to Org 3`);

        // Also move pipelines
        const pipelineResult = await pool.query('UPDATE pipelines SET organization_id = 3 WHERE organization_id = 1');
        console.log(`✅ Moved ${pipelineResult.rowCount} pipelines to Org 3`);

        // Verify
        const finalJobs = await pool.query('SELECT organization_id, COUNT(*) as count FROM jobs GROUP BY organization_id');
        console.log('\nJobs by organization:');
        finalJobs.rows.forEach((j: any) => console.log(`  Org ${j.organization_id}: ${j.count} jobs`));

    } finally {
        await pool.end();
    }
}

main();
