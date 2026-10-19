
import { db } from "../database_service.js";
import { missions } from "@shared/schema/index.js";
import { ilike } from "drizzle-orm";

async function main() {
    console.log("Listing all missions:");
    const allMissions = await db.select().from(missions);

    if (allMissions.length === 0) {
        console.log("No missions found.");
    } else {
        allMissions.forEach(m => {
            console.log(`[${m.id}] ${m.name} (Type: ${m.type}) - Objective: ${m.objective}`);
        });
    }

    console.log("\nSearching for 'hosting':");
    // Manual filter to be safe against ILIKE driver issues in this context
    const hostingMissions = allMissions.filter(m =>
        (m.objective && m.objective.toLowerCase().includes("hosting")) ||
        (m.name && m.name.toLowerCase().includes("hosting"))
    );

    if (hostingMissions.length > 0) {
        console.log("Found matches:");
        hostingMissions.forEach(m => console.log(m));
    } else {
        console.log("No missions found matching 'hosting'.");
    }
}

main().catch(console.error).finally(() => process.exit(0));

