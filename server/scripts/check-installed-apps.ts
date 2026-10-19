import { db } from "../database_service.js";
import { apps } from "../../shared/schema/apps.js";

async function main() {
    console.log("=== Checking Apps in DB ===");
    try {
        const rows = await db.select().from(apps);
        console.log(`Apps count: ${rows.length}`);
        for (const app of rows) {
            console.log(` - ID: ${app.id}, Name: "${app.name}", Slug: "${app.slug}", Status: "${app.status}"`);
        }
    } catch (err) {
        console.error("Error querying apps:", err);
    }
    process.exit(0);
}

main();
