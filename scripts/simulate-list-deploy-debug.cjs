const { Client } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function simulateListDeployments() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        await client.connect();

        const orgId = 1;
        console.log(`Simulating listOrgDeployments for OrgID: ${orgId}`);

        const q = `
            SELECT ad.id as deployment_id, a.id as app_id, a.name, a.slug
            FROM app_deployments ad
            INNER JOIN apps a ON ad.app_id = a.id
            WHERE ad.organization_id = $1
        `;
        const res = await client.query(q, [orgId]);

        console.log("Results:");
        if (res.rows.length === 0) {
            console.log("No deployments found.");
        } else {
            res.rows.forEach(r => {
                console.log(`- DeploymentID: ${r.deployment_id}, AppID: ${r.app_id}, Name: ${r.name}, Slug: ${r.slug}`);
            });
        }

    } catch (err) {
        console.error("Simulation failed:", err);
    } finally {
        await client.end();
    }
}

simulateListDeployments();
