import "dotenv/config";
import { db } from "../server/db/index.js";
import { credentials, systemSettings, orgs, users } from '../shared/schema/index';

async function run() {
    try {
        console.log("Querying database...");
        const creds = await db.select().from(credentials);
        const settings = await db.select().from(systemSettings);
        const allOrgs = await db.select().from(orgs);
        const allUsers = await db.select().from(users);

        console.log('--- ORGS ---');
        allOrgs.forEach(o => console.log(`ID: ${o.id}, Name: ${o.name}`));

        console.log('\n--- USERS ---');
        allUsers.forEach(u => console.log(`ID: ${u.id}, Username: ${u.username}, Email: ${u.email}`));

        console.log('--- CREDENTIALS ---');
        creds.forEach(c => {
            console.log(`ID: ${c.id}, Name: ${c.name}, Type: ${c.type}, Env: ${c.envVarName}, Meta: ${JSON.stringify(c.metadata)}`);
            if (c.envVarName) {
                console.log(`  Value in process.env: ${process.env[c.envVarName] ? 'SET' : 'MISSING'}`);
            }
        });

        console.log('\n--- SYSTEM_SETTINGS ---');
        settings.forEach(s => {
            console.log(`Key: ${s.key}, Data: ${JSON.stringify(s.settingsData, null, 2)}`);
        });

        process.exit(0);
    } catch (err) {
        console.error("Query failed:", err);
        process.exit(1);
    }
}

run();
