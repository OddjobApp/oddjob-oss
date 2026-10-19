import "dotenv/config";
import { db } from "../database_service.js";
import { users, adminRoles } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { pinService } from "../domain/auth/core/pin-service.js";

async function setUserPin() {
    const targetUsername = process.argv[2] || "admin";
    const rawPin = process.argv[3] || "123456";

    console.log(`🔒 Setting PIN for user "${targetUsername}" to "${rawPin}"...`);

    const validation = pinService.validatePin(rawPin);
    if (!validation.valid) {
        console.error(`❌ Invalid PIN format: ${validation.errors.join(", ")}`);
        process.exit(1);
    }

    const pinHash = await pinService.hashPin(rawPin);

    const [userRow] = await db
        .select()
        .from(users)
        .where(eq(users.username, targetUsername))
        .limit(1);

    if (!userRow) {
        console.log(`⚠️ User "${targetUsername}" not found. Searching for any Super Admin user...`);
        const [superAdmin] = await db
            .select({ id: users.id, username: users.username })
            .from(users)
            .innerJoin(adminRoles, eq(users.id, adminRoles.userId))
            .where(eq(adminRoles.role, "super_admin"))
            .limit(1);

        if (!superAdmin) {
            // Also search all users
            const [anyUser] = await db.select({ id: users.id, username: users.username }).from(users).limit(1);
            if (!anyUser) {
                console.error("❌ No users found in database.");
                process.exit(1);
            }
            await db.update(users).set({ pin: pinHash }).where(eq(users.id, anyUser.id));
            console.log(`✅ Updated PIN for default user "${anyUser.username}" (ID: ${anyUser.id}).`);
            process.exit(0);
        }

        await db.update(users).set({ pin: pinHash }).where(eq(users.id, superAdmin.id));
        console.log(`✅ Updated PIN for Super Admin user "${superAdmin.username}" (ID: ${superAdmin.id}).`);
        process.exit(0);
    }

    await db.update(users).set({ pin: pinHash }).where(eq(users.id, userRow.id));
    console.log(`✅ Updated PIN for user "${userRow.username}" (ID: ${userRow.id}).`);
    process.exit(0);
}

setUserPin().catch((err) => {
    console.error("❌ Error setting PIN:", err);
    process.exit(1);
});
