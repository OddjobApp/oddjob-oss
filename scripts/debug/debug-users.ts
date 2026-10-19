// @ts-nocheck
import "dotenv/config";
import { db } from "../../server/database_service.js";
import { users, adminRoles } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function debugUsers() {
    console.log("🔍 Checking users in database...");

    const allUsers = await db.select().from(users);
    console.log(`Found ${allUsers.length} users.`);

    for (const user of allUsers) {
        const [role] = await db.select().from(adminRoles).where(eq(adminRoles.userId, user.id));
        console.log(`- User: ${user.username}, Email: ${user.email}, Role: ${role?.roleType || 'none'}`);
    }

    process.exit(0);
}

debugUsers().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
