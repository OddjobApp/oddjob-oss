import { db } from "../../server/database_service.js";
import { sql } from 'drizzle-orm';

async function main() {
    console.log('--- Organizations ---');
    try {
        const orgsCount = await db.execute(sql`SELECT org_id as id, name FROM orgs`);
        console.log(JSON.stringify(orgsCount.rows, null, 2));
    } catch (err: any) {
        console.error(`Failed to query orgs: ${err.message}`);
    }

    console.log('\n--- Table Counts ---');
    const tables = await db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    for (const row of tables.rows) {
        const tableName = row.table_name as string;
        try {
            const countRes = await db.execute(sql.raw(`SELECT count(*) FROM "${tableName}"`));
            console.log(`${tableName}: ${countRes.rows[0].count}`);
        } catch (err: any) {
            console.error(`Failed to count ${tableName}: ${err.message}`);
        }
    }

    console.log('\n--- Pipelines Details ---');
    try {
        const pLines = await db.execute(sql`SELECT id, name, organization_id, is_active FROM pipelines`);
        console.log(JSON.stringify(pLines.rows, null, 2));
    } catch (err: any) {
        console.error(`Failed to query pipelines: ${err.message}`);
    }

    console.log('\n--- All Jobs ---');
    try {
        const allJobs = await db.execute(sql`SELECT id, name, type, organization_id FROM jobs`);
        console.log(JSON.stringify(allJobs.rows, null, 2));
    } catch (err: any) {
        console.error(`Failed to query all jobs: ${err.message}`);
    }
}

main().catch(console.error);
