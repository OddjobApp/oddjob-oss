
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@server/database_service.js";
import { apps } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import { appRegistryService } from "../app-registry.service.js";
import { resolveForgeWorkspacePath } from "./forge-paths.js";

const logger = createLogger("BlueprintExtractionService");
const BLUEPRINT_ROOT = path.resolve("server/blueprints/apps");

export interface ExtractionOptions {
    appSlug: string;
    newBlueprintSlug: string;
    newName: string;
    description?: string;
    missionRunId?: number;
    organizationId?: number;
}

export const blueprintExtractionService = {
    /**
     * Snapshots a forged app from the workspace and promotes it to a global blueprint.
     */
    async extractToBlueprint(options: ExtractionOptions) {
        const sourcePath = await resolveForgeWorkspacePath(options.appSlug);
        const targetPath = path.join(BLUEPRINT_ROOT, options.newBlueprintSlug);

        logger.info(`[BlueprintExtraction] Promoting ${options.appSlug} to blueprint: ${options.newBlueprintSlug}`);

        try {
            // 1. Verify source exists
            await fs.access(sourcePath);

            // 2. Prepare target
            await fs.mkdir(targetPath, { recursive: true });

            // 3. Copy files (excluding node_modules and .next if they exist)
            const entries = await fs.readdir(sourcePath, { withFileTypes: true });
            for (const entry of entries) {
                if (["node_modules", ".next", "dist", ".git", "oddjob.manifest.json"].includes(entry.name)) {
                    continue;
                }
                const src = path.join(sourcePath, entry.name);
                const dest = path.join(targetPath, entry.name);
                await fs.cp(src, dest, { recursive: true });
            }

            // 4. Create Blueprint Manifest
            const manifest = {
                name: options.newName,
                version: "1.0.0",
                description: options.description || `Extracted from successful mission run ${options.missionRunId}`,
                extractedAt: new Date().toISOString(),
                originalMissionRunId: options.missionRunId,
                baseSlug: options.appSlug
            };
            await fs.writeFile(path.join(targetPath, "oddjob.blueprint.json"), JSON.stringify(manifest, null, 2));

            // 5. Register in Marketplace
            const existing = await db.select().from(apps).where(eq(apps.slug, options.newBlueprintSlug)).limit(1);
            if (existing.length === 0) {
                await appRegistryService.registerApp({
                    name: options.newName,
                    slug: options.newBlueprintSlug,
                    description: manifest.description,
                    isPublic: true, // Mark as public for the org to use
                    version: "1.0.0",
                    isSystem: false,
                    developerOrgId: options.organizationId || null
                });
                logger.info(`[BlueprintExtraction] Successfully registered ${options.newBlueprintSlug} in marketplace.`);
            }

            return { success: true, blueprintSlug: options.newBlueprintSlug };
        } catch (err: any) {
            logger.error(`[BlueprintExtraction] Failed to extract blueprint: ${err.message}`);
            throw err;
        }
    }
};

// Helper for Drizzle (since I'm using eq inside the object)
import { eq } from "drizzle-orm";
