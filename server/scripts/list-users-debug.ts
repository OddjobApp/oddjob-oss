
import { db } from "../database_service.js";
import { users } from "@shared/schema/index.js";

async function listUsers() {
    console.log("--- Listing All Users in DB ---");
    try {
        const allUsers = await db.select().from(users);
        console.log(`Total Users: ${allUsers.length}`);
        allUsers.forEach(u => {
            console.log(`- ID: ${u.id}, Username: ${u.username}, Email: ${u.email}`);
        });
    } catch (error: any) {
        console.error("❌ Failed to list users:", error.message);
    }
}

listUsers();

