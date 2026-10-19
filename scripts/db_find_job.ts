
import pg from 'pg';
const { Client } = pg;

const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5433/oddjob',
});

async function run() {
    try {
        await client.connect();
        console.log("Searching for jobs...");

        const res = await client.query(`
            SELECT id, name, organization_id
            FROM jobs
            WHERE name ILIKE '%Vehicle%' OR name ILIKE '%Provision%'
        `);

        console.log("Jobs found:", JSON.stringify(res.rows, null, 2));

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await client.end();
    }
}

run();
