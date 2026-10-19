import pg from 'pg';
const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/oddjob";

async function run() {
    const client = new Client({
        connectionString: DATABASE_URL,
    });

    try {
        await client.connect();
        console.log("Connected to database");

        // 1. Fix agent_tool_hints pipeline_id reference
        // Drop existing constraint if it exists (we don't know the name, so we'll look it up or just try to alter)
        try {
            // Find the foreign key constraint name
            const res = await client.query(`
                SELECT constraint_name 
                FROM information_schema.key_column_usage 
                WHERE table_name = 'agent_tool_hints' AND column_name = 'pipeline_id' 
                AND table_schema = 'public'
            `);

            for (const row of res.rows) {
                console.log(`Dropping constraint ${row.constraint_name} on agent_tool_hints`);
                await client.query(`ALTER TABLE agent_tool_hints DROP CONSTRAINT "${row.constraint_name}"`);
            }

            console.log("Adding cascade delete constraint to agent_tool_hints");
            await client.query(`
                ALTER TABLE agent_tool_hints 
                ADD CONSTRAINT agent_tool_hints_pipeline_id_fkey 
                FOREIGN KEY (pipeline_id) REFERENCES pipelines(id) ON DELETE CASCADE
            `);
        } catch (err) {
            console.error("Error updating agent_tool_hints constraint:", err);
        }

        // 2. Fix agent_run_steps type/step_type if needed
        // If we want to rename step_type to type to match the current schema
        try {
            const res = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'agent_run_steps' AND column_name = 'step_type'
            `);
            if (res.rows.length > 0) {
                console.log("Renaming agent_run_steps.step_type to type");
                await client.query(`ALTER TABLE agent_run_steps RENAME COLUMN step_type TO type`);
            }
        } catch (err) {
            console.error("Error renaming agent_run_steps column:", err);
        }

        console.log("Successfully applied schema fixes");
    } catch (err) {
        console.error("Database connection error:", err);
    } finally {
        await client.end();
    }
}

run();
