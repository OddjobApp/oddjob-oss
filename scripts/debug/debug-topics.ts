import { db } from "@server/database_service.js";
import { knowledgeTopics, users, userOrgs } from '@shared/schema/index.js';
import { sql } from 'drizzle-orm';

async function debug() {
    console.log('=== Debug Knowledge Topics ===\n');

    // 1. List all topics
    const topics = await db.select().from(knowledgeTopics);
    console.log(`Total topics in database: ${topics.length}`);
    topics.forEach((t: any) => {
        console.log(`  - ID: ${t.id}, Name: "${t.name}", OrgId: ${t.organizationId}`);
    });

    // 2. List all users and their orgs
    console.log('\n=== Users and Organizations ===');
    const usersWithOrgs = await db.select({
        userId: users.id,
        username: users.username,
        defaultOrgId: users.defaultOrgId
    }).from(users);

    usersWithOrgs.forEach(u => {
        console.log(`  - User: ${u.username}, DefaultOrg: ${u.defaultOrgId}`);
    });

    // 3. Check user_orgs
    console.log('\n=== User-Org Mappings ===');
    const mappings = await db.select().from(userOrgs);
    mappings.forEach((m: any) => {
        console.log(`  - UserId: ${m.userId}, OrgId: ${m.orgId}`);
    });

    process.exit(0);
}

debug().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
