import pg from 'pg';

async function main() {
    console.log("SUPER REPAIR: Aligning Missions, Jobs, and Deployments...");
    const url = "postgresql://postgres:postgres@127.0.0.1:5433/oddjob";
    const pool = new pg.Pool({ connectionString: url });

    try {
        const query = async (text: string) => {
            console.log(`Executing: ${text}`);
            try {
                await pool.query(text);
                console.log("  -> SUCCESS");
            } catch (e: any) {
                console.log(`  -> INFO/ERROR: ${e.message}`);
            }
        };

        // 1. Repair MISSIONS table
        console.log("\n--- Aligning MISSIONS ---");
        const missionFixes = [
            "ALTER TABLE missions ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'supervisor_led'",
            "ALTER TABLE missions ADD COLUMN IF NOT EXISTS organization_id INTEGER",
            "ALTER TABLE missions ADD COLUMN IF NOT EXISTS objective TEXT",
            "ALTER TABLE missions ADD COLUMN IF NOT EXISTS blackboard JSONB DEFAULT '{}'::jsonb",
            "ALTER TABLE missions ADD COLUMN IF NOT EXISTS budget_limit_usd DECIMAL(10,2)",
            "ALTER TABLE missions ADD COLUMN IF NOT EXISTS current_spend_usd DECIMAL(10,2) DEFAULT 0.00",
            "ALTER TABLE missions ADD COLUMN IF NOT EXISTS governor_policy_id INTEGER",
            "ALTER TABLE missions ADD COLUMN IF NOT EXISTS created_by TEXT",
            "UPDATE missions SET created_by = 'admin' WHERE created_by IS NULL"
        ];
        for (const fix of missionFixes) await query(fix);

        // 2. Repair JOBS table
        console.log("\n--- Aligning JOBS ---");
        const jobFixes = [
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS parameter_schema JSONB",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS render_template TEXT",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cpu_limit_millicores INTEGER",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS memory_limit_mb INTEGER",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS output_storage_enabled BOOLEAN DEFAULT false",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS enable_knowledge_store BOOLEAN DEFAULT false",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS output_knowledge_topic_id INTEGER",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS output_dataset_id INTEGER",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS output_tags TEXT[] DEFAULT ARRAY[]::TEXT[]",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS output_storage_settings JSONB",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS input_schema JSONB",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS output_schema JSONB",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS test_config JSONB",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS diff_config JSONB DEFAULT '{}'::jsonb",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS governor_settings JSONB",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS governor_policy_id INTEGER"
        ];
        for (const fix of jobFixes) await query(fix);

        // 3. Repair AGENT_DEPLOYMENTS
        console.log("\n--- Aligning AGENT_DEPLOYMENTS ---");
        const deploymentFixes = [
            "ALTER TABLE agent_deployments ADD COLUMN IF NOT EXISTS welcome_message TEXT",
            "ALTER TABLE agent_deployments ADD COLUMN IF NOT EXISTS branding_config JSONB DEFAULT '{}'::jsonb",
            "ALTER TABLE agent_deployments ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true",
            "ALTER TABLE agent_deployments ADD COLUMN IF NOT EXISTS access_policy TEXT DEFAULT 'public'",
            "ALTER TABLE agent_deployments ADD COLUMN IF NOT EXISTS access_password_hash TEXT",
            "ALTER TABLE agent_deployments ADD COLUMN IF NOT EXISTS allowed_file_types TEXT[]",
            "ALTER TABLE agent_deployments ADD COLUMN IF NOT EXISTS max_file_size_mb INTEGER DEFAULT 10",
            "ALTER TABLE agent_deployments ADD COLUMN IF NOT EXISTS allowed_topic_ids INTEGER[]",
            "ALTER TABLE agent_deployments ADD COLUMN IF NOT EXISTS allowed_dataset_ids INTEGER[]",
            "ALTER TABLE agent_deployments ADD COLUMN IF NOT EXISTS allowed_pipeline_ids INTEGER[]",
            "ALTER TABLE agent_deployments ADD COLUMN IF NOT EXISTS form_manifest JSONB DEFAULT '{}'::jsonb",
            "ALTER TABLE agent_deployments ADD COLUMN IF NOT EXISTS embed_config JSONB DEFAULT '{}'::jsonb"
        ];
        for (const fix of deploymentFixes) await query(fix);

        // 4. Ensure foreign keys for mission_id
        console.log("\n--- Final mission_id Checks ---");
        const tables = ['knowledge_nodes', 'knowledge_edges', 'pipeline_executions', 'agent_chat_messages', 'agent_run_steps', 'optimization_suggestions'];
        for (const t of tables) {
            await query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL`);
        }

        console.log("\n--- ALL ALIGNMENTS COMPLETE ---");

    } finally {
        await pool.end();
        process.exit(0);
    }
}
main();

