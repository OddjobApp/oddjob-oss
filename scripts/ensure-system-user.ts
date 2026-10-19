import "dotenv/config";
import { db } from "../server/db/index.js";
import { users, orgs } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";
import { hashPassword } from "../server/domain/auth/index.js";
import crypto from "node:crypto";

async function ensureSystemUser() {
    console.log("🔍 Checking for system user...");

    const [existing] = await db.select().from(users).where(eq(users.id, "oddjob-system")).limit(1);

    if (existing) {
        console.log("✅ System user already exists.");
        process.exit(0);
    }

    console.log("➕ Creating system user...");

    // Find or create a default org for the system user
    let [defaultOrg] = await db.select().from(orgs).limit(1);
    if (!defaultOrg) {
        console.log("🏢 No org found, creating 'System Org'...");
        [defaultOrg] = await db.insert(orgs).values({
            name: "System Org",
        }).returning();
    }

    const systemPassword = await hashPassword(crypto.randomUUID());
    await db.insert(users).values({
        id: "oddjob-system",
        username: "system",
        password: systemPassword,
        email: "system@oddjob.ai",
        firstName: "Oddjob",
        lastName: "System",
        defaultOrgId: defaultOrg.id,
        quietHoursEnabled: false,
    });

    console.log("✅ System user created successfully!");
    process.exit(0);
}

ensureSystemUser().catch(err => {
    console.error("❌ Failed to ensure system user:", err);
    process.exit(1);
});
