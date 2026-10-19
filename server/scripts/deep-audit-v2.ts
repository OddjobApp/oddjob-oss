import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';

async function main() {
    const results = [];
    results.push("--- DEEP SCHEMA AUDIT ---");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const tables = ['pipeline_step_executions', 'mission_runs', 'mission_blackboard_history', 'mission_step_assignments'];

    try {
        for (const table of tables) {
            results.push(`--- Table: ${table} ---`);
            const res = await pool.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = '${table}'
            `);
            if (res.rows.length === 0) {
                results.push(`❌ Table '${table}' does not exist!`);
            } else {
                res.rows.forEach(r => {
                    results.push(`- ${r.column_name} (${r.data_type})`);
                });
            }
        }
    } catch (e: any) {
        results.push(`ERROR: ${e.message}`);
    } finally {
        await pool.end();
        results.push("--- AUDIT END ---");
        fs.writeFileSync('deep_schema_audit.log', results.join('\n'));
        process.exit(0);
    }
}

main();

