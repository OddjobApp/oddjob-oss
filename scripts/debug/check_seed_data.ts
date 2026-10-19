import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        console.log('=== JOBS STATUS ===\n');

        const jobs = await pool.query('SELECT COUNT(*) as count FROM jobs');
        console.log('Total Jobs:', jobs.rows[0].count);

        if (parseInt(jobs.rows[0].count) === 0) {
            console.log('\n⚠️  No jobs found in the database!');
            console.log('This could mean:');
            console.log('  1. The database was recently cleared/reset');
            console.log('  2. Seed data was never run');
            console.log('  3. Jobs were deleted');
        }

        console.log('\n=== CHECKING SEED DATA ===\n');

        const users = await pool.query('SELECT COUNT(*) as count FROM users');
        const pipelines = await pool.query('SELECT COUNT(*) as count FROM pipelines');

        console.log('Users:', users.rows[0].count);
        console.log('Pipelines:', pipelines.rows[0].count);

        console.log('\n=== SOLUTION ===\n');
        console.log('To restore jobs and other seed data, run:');
        console.log('  npm run db:seed');

    } finally {
        await pool.end();
    }
}

main();
