const { Client } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function cleanupGhost() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        await client.connect();

        console.log("Cleanup: Deleting ghost deployment for AppID: 1, OrgID: 1");

        const q = "DELETE FROM app_deployments WHERE app_id = 1 AND organization_id = 1";
        const res = await client.query(q);

        console.log(`Deleted ${res.rowCount} record(s).`);

    } catch (err) {
        console.error("Cleanup failed:", err);
    } finally {
        await client.end();
    }
}

cleanupGhost();
