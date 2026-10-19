import "dotenv/config";
import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function truncateAll() {
    console.log("⚠️ TRUNCATING ALL TABLES...");
    const tables = [
        'agent_chat_messages',
        'agent_run_steps',
        'ai_usage_logs',
        'app_user_usage',
        'pipeline_executions',
        'pipeline_step_executions',
        'pipeline_steps',
        'pipeline_input_params',
        'pipelines',
        'jobs',
        'schedules',
        'scheduled_jobs',
        'credentials',
        'system_settings',
        'org_settings',
        'user_orgs',
        'admin_roles',
        'users',
        'orgs'
    ];

    for (const table of tables) {
        try {
            await db.execute(sql.raw(`TRUNCATE TABLE "${table}" CASCADE`));
            console.log(`✅ Truncated ${table}`);
        } catch (e) {
            console.log(`❌ Failed to truncate ${table}: ${e}`);
        }
    }
    console.log("✨ Truncation complete.");
    process.exit(0);
}

truncateAll().catch(err => {
    console.error(err);
    process.exit(1);
});
