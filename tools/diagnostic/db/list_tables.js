
import pkg from 'pg';
const { Client } = pkg;

async function run() {
    const client = new Client({
        connectionString: "postgresql://postgres:postgres@127.0.0.1:5433/oddjob"
    });
    try {
        await client.connect();
        
        console.log("\n--- Public Tables ---");
        const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';");
        console.log(JSON.stringify(tables.rows, null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
run();
