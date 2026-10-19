
import pkg from 'pg';
const { Client } = pkg;

async function run() {
    const client = new Client({
        connectionString: "postgresql://postgres:postgres@127.0.0.1:5433/oddjob"
    });
    try {
        await client.connect();
        
        console.log("\n--- Pipeline Columns ---");
        const pCols = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'pipelines';");
        console.log(JSON.stringify(pCols.rows, null, 2));

        console.log("\n--- Job Columns ---");
        const jCols = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'jobs';");
        console.log(JSON.stringify(jCols.rows, null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
run();
