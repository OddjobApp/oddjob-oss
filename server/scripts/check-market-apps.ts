import { db } from "../database_service.js";
import { apps } from "@shared/schema/index.js";

async function main() {
    const list = await db.select().from(apps);
    console.log("=== ALL APPS IN DATABASE ===\n");
    list.forEach(a => {
        console.log(`ID: ${a.id} | Slug: ${a.slug} | Name: ${a.name} | isPublic: ${a.isPublic} | Version: ${a.version}`);
    });
    console.log(`\nTotal: ${list.length}`);
    const publicCount = list.filter(a => a.isPublic).length;
    console.log(`Public (visible in Global Market): ${publicCount}`);
    console.log(`Private (not visible): ${list.length - publicCount}`);
}
main().catch(console.error).finally(() => process.exit(0));
