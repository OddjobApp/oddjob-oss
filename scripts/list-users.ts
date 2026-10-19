
import { db } from "../server/db/index.js";
import { users } from "@shared/schema/index.js";

async function listUsers() {
    const allUsers = await db.select().from(users);
    console.log("Current Users:");
    allUsers.forEach(u => {
        console.log(`- [ID: ${u.id}] ${u.username} (${u.email})`);
    });
    process.exit(0);
}

listUsers().catch(err => {
    console.error(err);
    process.exit(1);
});
