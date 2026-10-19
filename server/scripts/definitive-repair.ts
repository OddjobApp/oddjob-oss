import pg from 'pg';

async function main() {
    console.log("DEFINITIVE Database State Check...");
    const url = "postgresql://postgres:postgres@127.0.0.1:5433/oddjob";
    const pool = new pg.Pool({ connectionString: url });

    try {
        const dbInfo = await pool.query("SELECT current_database(), current_schema(), version()");
        console.log("DB Context:", dbInfo.rows[0]);

        const tables = [
            'agent_chat_messages',
            'agent_run_steps',
            'agent_deployments',
            'jobs',
            'missions',
            'mission_runs',
            'mission_members',
            'mission_blackboard_history',
            'optimization_suggestions',
            'knowledge_nodes',
            'knowledge_edges',
            'pipeline_executions'
        ];

        for (const t of tables) {
            console.log(`\n--- TABLE: ${t} ---`);
            const res = await pool.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1 
                AND table_schema = 'public'
            `, [t]);

            if (res.rows.length === 0) {
                console.log("  [!] TABLE NOT FOUND IN PUBLIC SCHEMA");
            } else {
                const cols = res.rows.map(r => r.column_name);
                console.log("  Columns:", cols.join(', '));

                if (cols.includes('mission_id')) {
                    console.log("  [v] mission_id EXISTS");
                } else {
                    console.log("  [x] mission_id MISSING");
                    console.log("  Attempting to ADD mission_id...");
                    try {
                        await pool.query(`ALTER TABLE ${t} ADD COLUMN mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL`);
                        console.log("    -> ADDED SUCCESSFUL");
                    } catch (e: any) {
                        console.log(`    -> ADD FAILED: ${e.message}`);
                    }
                }
            }
        }

    } finally {
        await pool.end();
        process.exit(0);
    }
}
main();

