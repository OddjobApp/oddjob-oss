import { db } from "../server/db/index.js";
import { orgs, users, missions, alerts } from '../shared/schema/index.js';
import { sql } from 'drizzle-orm';

async function diagnose() {
    console.log('--- Database Diagnosis ---');
    try {
        const orgCount = await db.select({ count: sql<number>`count(*)` }).from(orgs);
        console.log('Organizations count:', orgCount[0].count);

        const userCount = await db.select({ count: sql<number>`count(*)` }).from(users);
        console.log('Users count:', userCount[0].count);

        const missionCount = await db.select({ count: sql<number>`count(*)` }).from(missions);
        console.log('Missions count:', missionCount[0].count);

        const alertCount = await db.select({ count: sql<number>`count(*)` }).from(alerts);
        console.log('Alerts count:', alertCount[0].count);

        if (orgCount[0].count > 0) {
            const allOrgs = await db.select().from(orgs);
            console.log('Organizations:', JSON.stringify(allOrgs, null, 2));
        }

    } catch (error) {
        console.error('Diagnosis failed:', error);
    } finally {
        process.exit(0);
    }
}

diagnose();
