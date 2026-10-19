import "dotenv/config";
import { db } from "../server/db/index.js";
import { users } from "../shared/schema/index.js";

async function checkUsers() {
    try {
        console.log("🔍 Checking users in database...");
        const allUsers = await db.select({
            id: users.id,
            username: users.username,
            email: users.email,
            password: users.password
        }).from(users);

        console.log(`✅ Found ${allUsers.length} users:`);
        console.log(JSON.stringify(allUsers, (key, value) => {
            if (key === 'password' && value) return '[HASHED]';
            return value;
        }, 2));
    } catch (error) {
        console.error("❌ Error checking users:", error);
    } finally {
        process.exit(0);
    }
}

checkUsers();
