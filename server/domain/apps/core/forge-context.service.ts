/**
 * Forge Context Service
 *
 * Powers the GET /api/apps/:slug/context endpoint.
 * Forged apps call this at runtime to fetch their mission-specific
 * configuration: systemPrompt, brandingConfig, orgId, missionContext.
 *
 * This converts static blueprint clones into runtime-configured apps
 * without requiring code generation for every config change.
 */

import { db } from "@server/database_service.js";
import { apps, appDeployments } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveForgeWorkspacePath } from "./forge-paths.js";

const logger = createLogger("ForgeContextService");

export interface AppRuntimeContext {
    slug: string;
    name: string;
    systemPrompt: string | null;
    brandingConfig: Record<string, any>;
    missionContext: Record<string, any>;
    organizationId: number | null;
    theme: string;
}

export const forgeContextService = {
    /**
     * Get runtime context for a forged app by its slug.
     * Merges: DB deployment config + oddjob.manifest.json
     */
    async getAppContext(slug: string): Promise<AppRuntimeContext | null> {
        try {
            // Primary source: DB (org-specific deployment config)
            const result = await db
                .select({ app: apps, deployment: appDeployments })
                .from(apps)
                .leftJoin(appDeployments, eq(appDeployments.appId, apps.id))
                .where(eq(apps.slug, slug))
                .limit(1);

            const row = result[0];
            if (!row) return null;

            // Secondary source: manifest.json (written at forge time)
            let manifestData: Record<string, any> = {};
            try {
                const manifestPath = path.join(await resolveForgeWorkspacePath(slug), "oddjob.manifest.json");
                const raw = await fs.readFile(manifestPath, "utf-8");
                manifestData = JSON.parse(raw);
            } catch {
                // manifest missing or unparseable — use DB only
            }

            return {
                slug,
                name: row.app.name,
                systemPrompt: row.deployment?.systemPrompt ?? manifestData.systemPrompt ?? null,
                brandingConfig: (row.deployment?.brandingConfig as Record<string, any>) ?? {},
                missionContext: manifestData.missionContext ?? {},
                organizationId: row.deployment?.organizationId ?? null,
                theme: manifestData.theme ?? "forensic-ghost",
            };
        } catch (err: any) {
            logger.error(`[ForgeContext] Failed to get context for ${slug}: ${err.message}`);
            return null;
        }
    },
};
