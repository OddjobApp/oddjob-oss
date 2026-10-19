
import "dotenv/config";
import { db } from "../server/db/index.js";
import { users, adminRoles } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    console.log("Looking for user 'admin2'...");
    const [user] = await db.select().from(users).limit(10); // Check first 10 users
    console.log("Users found:", user ? "Yes" : "No");

    const allUsers = await db.select().from(users);
    for (const u of allUsers) {
        console.log(`User ID: ${u.id}, Email: ${u.email}, DefaultOrg: ${u.defaultOrgId}`);
    }

    const roles = await db.select().from(adminRoles);
    for (const r of roles) {
        console.log(`Role: ${r.role}, UserID: ${r.userId}, OrgID: ${r.organizationId}`);
    }
}

main().catch(console.error).finally(() => process.exit());
