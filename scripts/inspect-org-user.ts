
import { db } from "../server/db/index.js";
import { orgs, users } from "../shared/schema/index.js";

async function inspectData() {
    try {
        const organizations = await db.select().from(orgs);
        console.log("--- ORGANIZATIONS ---");
        organizations.forEach(o => console.log(`ID: ${o.id}, Name: ${o.name}`));

        const adminUsers = await db.select().from(users);
        console.log("\n--- USERS ---");
        adminUsers.forEach(u => console.log(`ID: ${u.id}, Email: ${u.email}, Username: ${u.username}`));
    } catch (e) {
        console.error("Error inspecting data:", e);
    } finally {
        process.exit();
    }
}

inspectData();
