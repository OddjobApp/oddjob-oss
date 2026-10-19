import 'dotenv/config';
import { db } from "@server/database_service.js";
import { users } from '../../shared/schema/index.js';
import { eq } from 'drizzle-orm';
import { topicService } from "@domain/knowledge/core/topic-service.js";

async function main() {
    // Get admin user
    const [admin] = await db.select().from(users).where(eq(users.username, 'admin')).limit(1);
    if (!admin) {
        console.error('Admin user not found');
        return;
    }

    console.log('Admin user:', {
        id: admin.id,
        username: admin.username,
        defaultOrgId: admin.defaultOrgId
    });

    // Simulate org context
    const orgContext = {
        userId: admin.id,
        organizationId: admin.defaultOrgId,
        isAdmin: true,
        isSuperAdmin: true,
        isOrgAdmin: false
    };

    console.log('\nOrg Context:', orgContext);

    // Get topics
    const topics = await topicService.listTopics(orgContext, false);
    console.log('\nTopics returned by service:');
    topics.forEach((t: any) => console.log(`  ID: ${t.id} | Org: ${t.organizationId} | Name: ${t.name}`));

    console.log(`\nTotal topics returned: ${topics.length}`);
    console.log('Expected: Only topics with organization_id = 3 (or null if super admin has special access)');
}

main().then(() => process.exit(0)).catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
