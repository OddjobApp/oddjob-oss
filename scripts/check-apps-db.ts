import { db } from "../server/db/index.js";
import { apps } from "../shared/schema/apps.js";
import { sql } from "drizzle-orm";

async function checkApps() {
    try {
        const allApps = await db.select().from(apps);
        console.log("Total apps in DB:", allApps.length);
        allApps.forEach(app => {
            console.log(`- [${app.id}] ${app.name} (slug: ${app.slug}, public: ${app.isPublic}, system: ${app.isSystem})`);
        });
    } catch (err) {
        console.error("Query failed:", err);
    }
    process.exit(0);
}

checkApps().catch(err => {
    console.error(err);
    process.exit(1);
});
