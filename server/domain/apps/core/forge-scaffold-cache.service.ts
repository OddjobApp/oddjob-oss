import path from "node:path";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { forgeFoundationService } from "./forge-foundation.service.js";
import { uiRegistryService } from "./ui-registry.service.js";
import { forgeCodegenService, type CachedScaffold } from "./forge-codegen.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ForgeScaffoldCache");
const BLUEPRINT_ROOT = path.resolve("server/blueprints/apps");
const CACHE_TTL = 86400; // 24h
const MAX_SOURCE_CHARS = 100_000;

export const forgeScaffoldCache = {
    /**
     * Retrieves a cached scaffold from Redis.
     */
    async get(blueprintSlug: string): Promise<CachedScaffold | null> {
        try {
            const raw = await redis.get(`forge:scaffold:${blueprintSlug}`);
            return raw ? JSON.parse(raw) : null;
        } catch (err: any) {
            logger.warn(`Failed to read from scaffold cache: ${err.message}`);
            return null;
        }
    },

    /**
     * Saves a scaffold to Redis cache.
     */
    async set(blueprintSlug: string, data: CachedScaffold): Promise<void> {
        try {
            await redis.set(`forge:scaffold:${blueprintSlug}`, JSON.stringify(data), 'EX', CACHE_TTL);
        } catch (err: any) {
            logger.warn(`Failed to write to scaffold cache: ${err.message}`);
        }
    },

    /**
     * Rebuilds the cache for a specific blueprint by reading from disk.
     */
    async rebuild(blueprintSlug: string): Promise<CachedScaffold> {
        logger.info(`Rebuilding scaffold cache for ${blueprintSlug}...`);
        
        // Use the same snapshot logic as forge-codegen
        const snapshot = await forgeFoundationService.snapshotDirectory(
            path.join(BLUEPRINT_ROOT, blueprintSlug),
            MAX_SOURCE_CHARS / 2
        );
        
        const uiPalette = await uiRegistryService.getUIPaletteManifest();
        const slots = forgeCodegenService.detectSlots(snapshot);
        
        const data: CachedScaffold = {
            blueprintSnapshot: snapshot,
            uiPalette,
            slots,
            cachedAt: Date.now()
        };
        
        await this.set(blueprintSlug, data);
        return data;
    },

    /**
     * Warms up the cache for all registered blueprints.
     * Called at server boot.
     */
    async warmAll(): Promise<void> {
        try {
            // Lazy import to avoid circular dependencies
            const { blueprintRegistryService } = await import("../blueprint-registry.service.js");
            const blueprints = await blueprintRegistryService.listAll();
            
            logger.info(`Warming scaffold cache for ${blueprints.length} blueprints...`);
            
            // Rebuild in sequence to avoid overwhelming disk I/O at boot
            for (const blueprint of blueprints) {
                await this.rebuild(blueprint.slug);
            }
            
            logger.info("Scaffold cache warming complete.");
        } catch (err: any) {
            logger.error(`Failed to warm scaffold cache: ${err.message}`);
        }
    }
};
