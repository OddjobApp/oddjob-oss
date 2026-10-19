import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { sql } from "drizzle-orm";
import { db } from "../database_service.js";
import { blueprints, apps } from "@shared/schema/index.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("SeedBlueprints");
const BLUEPRINT_ROOT = path.resolve(process.cwd(), "server/blueprints/apps");
const CYCLES_ROOT = path.resolve(process.cwd(), "server/cycles");

export async function syncBlueprintsAndApps() {
    logger.info(`Scanning blueprints in ${BLUEPRINT_ROOT} and ${CYCLES_ROOT}...`);
    const syncedApps: string[] = [];

    // 1. Scan filesystem app directories
    try {
        const dirs = await fs.readdir(BLUEPRINT_ROOT, { withFileTypes: true });
        const appSlugs = dirs.filter(d => d.isDirectory() && d.name !== 'retired' && d.name !== 'shared').map(d => d.name);

        for (const slug of appSlugs) {
            const blueprintPath = path.join(BLUEPRINT_ROOT, slug);
            let pkg: any = {};
            
            try {
                const pkgRaw = await fs.readFile(path.join(blueprintPath, "package.json"), "utf-8");
                pkg = JSON.parse(pkgRaw);
            } catch {
                // Using default package info if not found
            }

            const name = pkg.name || slug.split('-').map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
            const description = pkg.description || `Industrial template for ${name}`;
            const version = pkg.version || "1.0.0";

            try {
                await db.insert(blueprints).values({
                    slug,
                    name,
                    description,
                    version,
                    basePath: blueprintPath,
                    manifest: pkg,
                    configSchema: {}, 
                    isPublic: true,
                    category: "web_app",
                    tags: pkg.keywords || []
                }).onConflictDoUpdate({
                    target: blueprints.slug,
                    set: {
                        name,
                        description,
                        version,
                        basePath: blueprintPath,
                        manifest: pkg,
                        updatedAt: new Date()
                    }
                });

                await db.insert(apps).values({
                    name,
                    slug,
                    description,
                    version,
                    isPublic: true,
                    isSystem: true,
                    distribution: "standard",
                    blueprint: slug,
                    blueprintSlug: slug,
                    status: "active",
                    // A scaffold row: lookups need it, the marketplace shelf does not.
                    config: { hiddenFromMarket: true },
                    runtimeMetadata: {},
                }).onConflictDoUpdate({
                    target: apps.slug,
                    set: {
                        name,
                        description,
                        version,
                        isPublic: true,
                        isSystem: true,
                        distribution: "standard",
                        blueprint: slug,
                        blueprintSlug: slug,
                        status: "active",
                        config: sql`${apps.config} || '{"hiddenFromMarket": true}'::jsonb`,
                        updatedAt: new Date()
                    }
                });

                syncedApps.push(slug);
            } catch (err: any) {
                logger.warn(`Failed to sync directory blueprint/app for ${slug}:`, err?.message);
            }
        }
    } catch (err: any) {
        logger.warn(`Could not read blueprint root at ${BLUEPRINT_ROOT}: ${err?.message}`);
    }

    // 2. Scan YAML cycle blueprints in server/cycles/*.cycle.yaml
    try {
        const cycleFiles = await fs.readdir(CYCLES_ROOT);
        const yamlFiles = cycleFiles.filter(f => f.endsWith('.cycle.yaml'));

        for (const file of yamlFiles) {
            const slug = file.replace(/\.cycle\.yaml$/, '');
            const filePath = path.join(CYCLES_ROOT, file);

            try {
                const rawYaml = await fs.readFile(filePath, 'utf-8');
                const doc: any = yaml.load(rawYaml);
                if (!doc || typeof doc !== 'object') continue;

                const name = doc.ui_metadata?.display_name || doc.name || slug.split('-').map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
                const description = doc.description || `Cycle blueprint: ${name}`;
                const version = doc.version || "1.0.0";
                const category = doc.ui_metadata?.category || "operations";

                await db.insert(blueprints).values({
                    slug,
                    name,
                    description,
                    version,
                    basePath: filePath,
                    manifest: doc,
                    configSchema: {},
                    isPublic: true,
                    category,
                    tags: [category, "cycle_blueprint"]
                }).onConflictDoUpdate({
                    target: blueprints.slug,
                    set: {
                        name,
                        description,
                        version,
                        basePath: filePath,
                        manifest: doc,
                        updatedAt: new Date()
                    }
                });

                await db.insert(apps).values({
                    name,
                    slug,
                    description,
                    version,
                    isPublic: true,
                    isSystem: true,
                    distribution: "standard",
                    blueprint: slug,
                    blueprintSlug: slug,
                    status: "active",
                    config: {
                        cycleApp: {
                            blueprint: slug,
                            sourceCycleSlug: slug,
                            sourceCycleName: name
                        }
                    },
                    runtimeMetadata: {
                        cycleApp: {
                            blueprint: slug,
                            sourceCycleSlug: slug,
                            sourceCycleName: name
                        }
                    },
                }).onConflictDoUpdate({
                    target: apps.slug,
                    set: {
                        name,
                        description,
                        version,
                        isPublic: true,
                        isSystem: true,
                        distribution: "standard",
                        blueprint: slug,
                        blueprintSlug: slug,
                        status: "active",
                        config: {
                            cycleApp: {
                                blueprint: slug,
                                sourceCycleSlug: slug,
                                sourceCycleName: name
                            }
                        },
                        updatedAt: new Date()
                    }
                });

                if (!syncedApps.includes(slug)) syncedApps.push(slug);
            } catch (yamlErr: any) {
                logger.warn(`Failed parsing cycle YAML ${file}:`, yamlErr?.message);
            }
        }
    } catch (err: any) {
        logger.warn(`Could not read cycles root at ${CYCLES_ROOT}: ${err?.message}`);
    }

    try {
        const { redis } = await import("../domain/core/infrastructure/redis/redis-client.js");
        await redis.del("apps:market:true", "apps:market:false").catch(() => {});
    } catch {}

    // Auto-populate default app deployments for Organization 1
    try {
        const { seedProvisioningService } = await import("../domain/agent-cards/core/seed-provisioning.service.js");
        await seedProvisioningService.ensureDefaultAppDeployments(1, true);
    } catch (deployErr: any) {
        logger.warn("Auto-deploying default apps for org 1 failed:", deployErr?.message);
    }

    logger.info(`Blueprint and app marketplace seeding complete (${syncedApps.length} synced).`);
    return syncedApps;
}

// CLI runner if executed directly
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
    syncBlueprintsAndApps().then(() => process.exit(0)).catch((err) => {
        logger.error("Seeding failed", err);
        process.exit(1);
    });
}

