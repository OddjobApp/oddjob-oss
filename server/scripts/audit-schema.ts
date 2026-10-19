import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';

async function main() {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const report: string[] = [];
        const tables = ['knowledge_nodes', 'knowledge_edges', 'pipeline_executions', 'approval_requests'];

        for (const table of tables) {
            const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = $1", [table]);
            report.push(`TABLE: ${table}`);
            res.rows.forEach(r => report.push(`  - ${r.column_name}`));
            report.push("");
        }

        fs.writeFileSync('db_schema_audit.txt', report.join('\n'));
        console.log("Schema audit written to db_schema_audit.txt");
    } finally {
        await pool.end();
        process.exit(0);
    }
}
main();

