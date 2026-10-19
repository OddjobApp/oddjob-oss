
import pg from 'pg';
const { Client } = pg;

const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5433/oddjob',
});

async function run() {
    try {
        await client.connect();
        const pipelineId = 30;
        console.log(`Inspecting Pipeline Params for Pipeline ${pipelineId}...`);

        const paramsFn = await client.query(`
            SELECT id, name, data_type, allowed_values
            FROM pipeline_input_params
            WHERE pipeline_id = $1
        `, [pipelineId]);

        console.log("Params Found:", paramsFn.rows);

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await client.end();
    }
}

run();
