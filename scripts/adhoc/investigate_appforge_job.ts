import dotenv from 'dotenv';
dotenv.config({ override: true });

import { Pool } from 'pg';

async function investigateJob() {
    if (!process.env.DATABASE_URL) {
        console.error('ERROR: DATABASE_URL not set');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    try {
        const jobId = 'fead68ff-4b98-458f-a07b-4708ad865325';

        console.log(`🔍 Investigating App Forge Job: ${jobId}\n`);
        console.log(''.padEnd(120, '='));

        // Search for this job ID (UUID format) in various places
        let foundJob = null;

        // Try searching in text/jsonb columns that might contain this UUID
        const searchResult = await pool.query(
            `SELECT table_name, column_name FROM information_schema.columns
             WHERE (data_type = 'uuid' OR data_type = 'text' OR data_type IN ('jsonb', 'json'))
             AND table_schema = 'public'
             LIMIT 20`
        );

        console.log(`Searching for job ID across database...\n`);

        // Simple search: look in pipeline_executions, mission_runs metadata
        const tableSearches = [
            { table: 'pipeline_executions', whereClause: `metadata @> $1` },
            { table: 'mission_runs', whereClause: `metadata::text LIKE $2` },
        ];

        for (const search of tableSearches) {
            try {
                const result = await pool.query(
                    `SELECT * FROM ${search.table} WHERE ${search.whereClause} LIMIT 1`,
                    [JSON.stringify({ jobId }), `%${jobId}%`]
                );
                if (result.rows.length > 0) {
                    foundJob = { table: search.table, data: result.rows[0] };
                    break;
                }
            } catch (e) {
                // Continue searching
            }
        }

        if (!foundJob) {
            console.log(`❌ Job ID not found in searchable records`);
            console.log(`\nNote: Job ID format looks like a UUID (${jobId})`);
            console.log(`This may be from an external system or archived record.\n`);
            process.exit(0);
        }

        const job = foundJob.data;
        console.log(`✅ Found in table: ${foundJob.table}\n`);

        console.log(`✅ Found Job\n`);
        console.log(`Job ID:          ${job.id}`);
        console.log(`Name:            ${job.name}`);
        console.log(`Type:            ${job.type}`);
        console.log(`Status:          ${job.status}`);
        console.log(`Organization:    ${job.organization_id}`);
        console.log(`Created By:      ${job.created_by}`);
        console.log(`Created At:      ${job.created_at ? new Date(job.created_at).toLocaleString() : 'N/A'}`);
        console.log(`Updated At:      ${job.updated_at ? new Date(job.updated_at).toLocaleString() : 'N/A'}`);
        console.log(`Input:           ${JSON.stringify(job.input).substring(0, 200)}...`);
        console.log(`Output:          ${JSON.stringify(job.output).substring(0, 200)}...`);

        if (job.status === 'failed') {
            console.log(`\n⚠️  Job Status: FAILED`);
            console.log(`Error Output: ${job.error || 'No error message'}`);
        } else if (job.status === 'running') {
            console.log(`\n⏳ Job Status: RUNNING`);
        } else if (job.status === 'completed') {
            console.log(`\n✅ Job Status: COMPLETED`);
        }

        console.log('\n' + ''.padEnd(120, '='));

        // Check for related mission runs
        const relatedMissions = await pool.query(
            `SELECT id, status, created_at FROM mission_runs WHERE metadata @> $1 LIMIT 5`,
            [JSON.stringify({ jobId: jobId })]
        );

        if (relatedMissions.rows.length > 0) {
            console.log(`\nRelated Mission Runs:\n`);
            for (const mission of relatedMissions.rows) {
                console.log(`  • Mission ${mission.id}: ${mission.status} (${new Date(mission.created_at).toLocaleString()})`);
            }
        }

    } catch (error: any) {
        console.error('ERROR:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

investigateJob();
