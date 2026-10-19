import "dotenv/config";
import { db } from "@server/database_service.js";
import { users, orgs, userOrgs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    console.log("--- Organizations ---");
    const organizations = await db.select().from(orgs);
    console.log(JSON.stringify(organizations, null, 2));

    console.log("\n--- User Assignments ---");
    const assignments = await db.select({
        userId: userOrgs.userId,
        orgId: userOrgs.orgId,
        username: users.username,
        orgName: orgs.name
    }).from(userOrgs)
        .innerJoin(users, eq(userOrgs.userId, users.id))
        .innerJoin(orgs, eq(userOrgs.orgId, orgs.id));
    console.log(JSON.stringify(assignments, null, 2));

    process.exit(0);
}

main().catch(console.error);
