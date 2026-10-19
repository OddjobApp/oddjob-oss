import pg from 'pg';

async function main() {
    console.log("EXHAUSTIVE Schema Audit for Port 5433...");
    const url = "postgresql://postgres:postgres@127.0.0.1:5433/oddjob";
    const pool = new pg.Pool({ connectionString: url });

    try {
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
            console.log(`\nTable: ${t}`);
            const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'", [t]);
            if (res.rows.length === 0) {
                console.log("  -> NOT FOUND");
            } else {
                const cols = res.rows.map(r => r.column_name);
                console.log(`  - Columns: ${cols.join(', ')}`);

                // Specifically check for mission_id
                if (!cols.includes('mission_id')) {
                    console.log("  !!! MISSING mission_id !!!");
                }
            }
        }

    } finally {
        await pool.end();
        process.exit(0);
    }
}
main();

