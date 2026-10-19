/**
 * Register All Cycle Blueprints in the App Arsenal Global Market
 *
 * Scans server/cycles/ for all *.cycle.yaml files, parses them,
 * and upserts them as public system apps in the database.
 * Finally, flushes the Redis market cache.
 *
 * Usage: npx tsx server/scripts/register-all-blueprints-market.ts
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { db } from "../database_service.js";
import { apps } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { redis } from "../domain/core/infrastructure/redis/redis-client.js";

async function main() {
    console.log("\n🚀 Starting Bulk Cycle Blueprints Registration...\n");

    const cyclesDir = path.resolve(process.cwd(), "server/cycles");
    if (!fs.existsSync(cyclesDir)) {
        console.error(`❌ Cycles directory not found at ${cyclesDir}`);
        process.exit(1);
    }

    const files = fs.readdirSync(cyclesDir).filter(file => file.endsWith(".cycle.yaml"));
    console.log(`📂 Found ${files.length} cycle blueprint files.\n`);

    let registeredCount = 0;
    let updatedCount = 0;

    for (const file of files) {
        const filePath = path.join(cyclesDir, file);
        let manifest: any;
        try {
            manifest = yaml.load(fs.readFileSync(filePath, "utf8"));
        } catch (e: any) {
            console.warn(`⚠️  Failed to parse ${file}: ${e.message}`);
            continue;
        }

        if (!manifest || !manifest.name) {
            console.warn(`⚠️  Skipping ${file}: Missing 'name' in manifest.`);
            continue;
        }

        // Derive slug from filename to ensure idempotency and matching
        let slug = file.replace(/\.cycle\.yaml$/, "");
        if (slug === "product-launch") {
            slug = "product-launch-cycle";
        }

        // Derive values
        const name = manifest.name;
        const description = manifest.description || `AI-powered lifecycle cycle for ${manifest.ui_metadata?.display_name || name}.`;
        const icon = manifest.ui_metadata?.icon || "⚙️";
        const category = manifest.ui_metadata?.category || "operations";
        const agentCount = manifest.agents?.length || 0;
        const missionCount = manifest.missions?.length || 0;
        const workbenchesCount = manifest.workbenches?.length || 0;
        
        // Build dynamic features list
        const features: string[] = [];
        if (agentCount > 0) {
            const agentNames = manifest.agents.map((a: any) => a.name || a.id).slice(0, 5).join(", ");
            features.push(`${agentCount} AI Agent${agentCount > 1 ? "s" : ""} (${agentNames}${manifest.agents.length > 5 ? "..." : ""})`);
        }
        if (missionCount > 0) {
            const missionNames = manifest.missions.map((m: any) => m.name || m.id).slice(0, 5).join(", ");
            features.push(`${missionCount} Orchestrated Mission${missionCount > 1 ? "s" : ""} (${missionNames}${manifest.missions.length > 5 ? "..." : ""})`);
        }
        if (workbenchesCount > 0) {
            const workbenchNames = manifest.workbenches.map((w: any) => w.name || w.id).slice(0, 5).join(", ");
            features.push(`${workbenchesCount} Workbench${workbenchesCount > 1 ? "es" : ""} (${workbenchNames}${manifest.workbenches.length > 5 ? "..." : ""})`);
        }
        const integrationKeys = Object.keys(manifest.integrations || {});
        if (integrationKeys.length > 0) {
            features.push(`Integrations: ${integrationKeys.join(", ")}`);
        }
        features.push(`Category: ${category}`);

        const config = {
            type: "cycle_blueprint",
            cycleYamlPath: `server/cycles/${file}`,
            category,
            features,
            agents: agentCount,
            missions: missionCount,
            integrations: integrationKeys,
        };

        const blueprint = slug === "product-launch-cycle" ? "product-launch-workbench" : slug;

        // Check if already registered
        const [existing] = await db.select().from(apps)
            .where(eq(apps.slug, slug))
            .limit(1);

        if (existing) {
            console.log(`🔄 Updating existing registry for slug: "${slug}" (${name})`);
            await db.update(apps).set({
                name,
                description,
                icon,
                isPublic: true,
                isSystem: true,
                distribution: "standard",
                blueprint,
                config,
                updatedAt: new Date()
            }).where(eq(apps.id, existing.id));
            updatedCount++;
        } else {
            console.log(`➕ Registering new market app for slug: "${slug}" (${name})`);
            await db.insert(apps).values({
                name,
                slug,
                description,
                icon,
                isPublic: true,
                isSystem: true,
                distribution: "standard",
                blueprint,
                status: "active",
                version: "1.0.0",
                createdBy: "system",
                config,
                pricePerLaunchUsd: "0",
                changelog: `Initial market registration of ${name} cycle blueprint.`,
            } as any);
            registeredCount++;
        }
    }

    console.log(`\n✅ Registration complete: ${registeredCount} registered, ${updatedCount} updated.`);

    // Flush Redis Cache
    console.log("🧹 Flushing Redis market cache...");
    await redis.del('apps:market:true');
    await redis.del('apps:market:false');
    console.log("✨ Redis market cache cleared successfully.");

    process.exit(0);
}

main().catch(err => {
    console.error("❌ Registration failed:", err);
    process.exit(1);
});
