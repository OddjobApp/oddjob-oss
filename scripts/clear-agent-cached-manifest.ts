import "dotenv/config";
import pg from "pg";

async function run() {
    const client = new pg.Client(process.env.DATABASE_URL);
    await client.connect();

    try {
        await client.query(`
            UPDATE agent_deployments 
            SET form_manifest = NULL,
                tool_manifest = NULL
            WHERE job_id = (SELECT id FROM jobs WHERE name = 'QA Planner Agent' LIMIT 1)
        `);
        console.log("Successfully cleared form_manifest and tool_manifest for QA Planner Agent");

    } catch (err) {
        console.error("Error executing SQL:", err);
    } finally {
        await client.end();
    }
}

run();
