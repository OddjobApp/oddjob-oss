/**
 * Backfill isPublic=true for all cycle-provisioned apps
 *
 * Cycle-installed apps (those with config.cycleApp metadata) were previously
 * inserted with isPublic=false (or null), so they never appeared in the Global
 * Market tab.  This script finds all such apps and flips the flag.
 *
 * It also flushes the Redis cache key so the marketplace shows them immediately.
 *
 * Usage: npx tsx server/scripts/backfill-apps-ispublic.ts
 */
import { db } from "../database_service.js";
import { apps } from "../../shared/schema/index.js";
import { sql, inArray } from "drizzle-orm";
import { redis } from "../domain/core/infrastructure/redis/redis-client.js";

async function main() {
    console.log("\n🔍 Finding cycle-provisioned apps with isPublic=false...\n");

    // Find all apps that have cycleApp metadata in their config but are not public
    const rows = await db
        .select({ id: apps.id, name: apps.name, slug: apps.slug, isPublic: apps.isPublic })
        .from(apps)
        .where(
            sql`(${apps.config}->>'cycleApp') IS NOT NULL AND ${apps.isPublic} IS DISTINCT FROM true`
        );

    if (rows.length === 0) {
        console.log("✅ No apps need backfilling — all cycle apps are already public.");
    } else {
        console.log(`📦 Found ${rows.length} app(s) to update:\n`);
        for (const row of rows) {
            console.log(`   • [${row.id}] ${row.name} (${row.slug}) — isPublic was: ${row.isPublic}`);
        }

        const ids = rows.map(r => r.id);

        // Update in a single statement
        const updated = await db
            .update(apps)
            .set({ isPublic: true, updatedAt: new Date() })
            .where(inArray(apps.id, ids));

        console.log(`\n✅ Updated ${rows.length} app(s) to isPublic=true.`);
    }

    // Flush the Redis market cache so the change is immediately visible
    try {
        await redis.del("apps:market:true");
        await redis.del("apps:market:false");
        console.log("🗑️  Redis market cache flushed.");
    } catch (err: any) {
        console.warn(`⚠️  Redis flush failed (non-fatal): ${err.message}`);
    }

    console.log("\nDone.\n");
    process.exit(0);
}

main().catch(err => {
    console.error("Fatal:", err);
    process.exit(1);
});
