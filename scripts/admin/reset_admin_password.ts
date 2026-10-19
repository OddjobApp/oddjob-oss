import "dotenv/config";
import { db } from "../../server/db/index.js";
import { users } from "@shared/schema";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";
import { eq } from "drizzle-orm";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const buf = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${buf.toString("hex")}.${salt}`;
}

async function resetAdminPassword() {
    console.log("Resetting admin password...");
    const newPassword = await hashPassword("oddjob123");

    await db.update(users)
        .set({ password: newPassword })
        .where(eq(users.username, "admin"));

    console.log("✅ Admin password reset to: oddjob123");
    process.exit(0);
}

resetAdminPassword().catch((err) => {
    console.error("❌ Failed to reset password:", err);
    process.exit(1);
});
