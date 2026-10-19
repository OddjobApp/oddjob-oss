import { db } from "../../server/database_service.js";
import { apps } from "../../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function checkApps() {
    try {
        console.log("--- Recent Apps ---");
        const recentApps = await db.select().from(apps).orderBy(desc(apps.createdAt)).limit(10);
        console.log(JSON.stringify(recentApps.map((a: any) => ({ id: a.id, slug: a.slug, createdAt: a.createdAt })), null, 2));

        const shelflife = await db.select().from(apps).where(eq(apps.slug, 'shelflife12'));
        console.log(`\nShelflife12 search: ${JSON.stringify(shelflife, null, 2)}`);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkApps();
