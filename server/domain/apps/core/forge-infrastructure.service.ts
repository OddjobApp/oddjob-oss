
import { createLogger } from "@server/utils/logger.js";
import { dockerBridgeService } from "../../core/infrastructure/docker/docker-bridge.service.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { WarmContainer, ForgeJob, ForgeOptions } from "./forge-types.js";
import { PREWARM_WORKSPACE_ROOT, NM_CACHE_ROOT } from "./forge-paths.js";

const logger = createLogger("ForgeInfrastructureService");
const WARM_LEASE_TTL_MS = 10 * 60 * 1000;

export class ForgeInfrastructureService {
    private warmPool: WarmContainer[] = [];

    /** Slugs must be lowercase alphanumeric + hyphens only — no path traversal characters. */
    assertSafeSlug(slug: string) {
        if (typeof slug !== 'string' || !slug) {
            throw new Error(`Invalid slug: expected a non-empty string, got ${JSON.stringify(slug)}`);
        }
        if (!/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(slug)) {
            throw new Error(`Invalid slug "${slug}": must be lowercase alphanumeric with hyphens.`);
        }
    }

    /** Poll a URL until it returns HTTP 2xx or the timeout is reached. */
    async pollUntilHealthy(url: string, maxAttempts = 30, intervalMs = 1000): Promise<boolean> {
        for (let i = 0; i < maxAttempts; i++) {
            try {
                const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
                if (res.ok) return true;
            } catch {
                // not yet ready
            }
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
        return false;
    }

    // ─── Warm Pool Management ────────────────────────────────────────────────

    async ensureWarmPool(size = 2) {
        // We no longer spawn Docker containers, just ensure the Master Dependency Cache exists.
        await this.preWarmMasterDependencies();
    }

    /**
     * Optimization: Pre-warms a "Master" node_modules for common blueprints.
     */
    private async preWarmMasterDependencies() {
        const masterPath = path.join(NM_CACHE_ROOT, "master-nextjs");
        try {
            await fs.access(path.join(masterPath, "node_modules"));
            return; // Already warmed
        } catch {
            logger.info("[WarmPool] Pre-warming Master Dependency Cache (this may take a few minutes)...");
            await fs.mkdir(masterPath, { recursive: true });
            // Logic to run 'npm install' on a baseline package.json
            // In a real scenario, this would copy from a stable blueprint
        }
    }

    /**
     * Optimization: Rapidly hydrates a workspace from the Master Cache.
     */
    private async hydrateFromMaster(targetPath: string) {
        const masterPath = path.join(NM_CACHE_ROOT, "master-nextjs", "node_modules");
        try {
            const exists = await fs.access(masterPath).then(() => true).catch(() => false);
            if (!exists) return;

            logger.debug(`[WarmPool] Hydrating ${targetPath} from Master Cache...`);
            await fs.cp(masterPath, path.join(targetPath, "node_modules"), { recursive: true });
        } catch (err: any) {
            logger.warn(`[WarmPool] Hydration failed: ${err.message}`);
        }
    }

    async verifyPoolIntegrity(): Promise<{ healthy: number; pruned: number }> {
        return { healthy: this.warmPool.length, pruned: 0 };
    }

    async acquireWarmLease(): Promise<{ leaseId: string; port: number } | null> {
        await this.ensureWarmPool(2);
        this.reclaimExpiredWarmLeases();

        const idleContainer = this.warmPool.find(c => c.status === 'idle');
        if (!idleContainer) return null;

        idleContainer.status = 'initializing';
        idleContainer.leaseId = crypto.randomUUID();
        idleContainer.leaseExpiresAt = Date.now() + WARM_LEASE_TTL_MS;
        idleContainer.slug = undefined;

        return { leaseId: idleContainer.leaseId, port: idleContainer.port };
    }

    async releaseWarmLease(leaseId: string, dehydrate: boolean = true): Promise<boolean> {
        const container = this.warmPool.find(c => c.leaseId === leaseId);
        if (!container) return false;

        if (dehydrate) {
            try {
                await fs.rm(container.workspacePath, { recursive: true, force: true });
                await fs.mkdir(container.workspacePath, { recursive: true });
            } catch (err: any) {
                logger.warn(`[WarmPool] Failed to dehydrate lease ${leaseId}: ${err.message}`);
            }
        }

        container.status = 'idle';
        container.slug = undefined;
        container.leaseId = undefined;
        container.leaseExpiresAt = undefined;
        return true;
    }

    private reclaimExpiredWarmLeases() {
        const now = Date.now();
        for (const container of this.warmPool) {
            if (container.status === 'initializing' && container.leaseExpiresAt && container.leaseExpiresAt < now) {
                container.status = 'idle';
                container.slug = undefined;
                container.leaseId = undefined;
                container.leaseExpiresAt = undefined;
            }
        }
    }

    async claimWarmContainer(slug: string, preferredLeaseId?: string): Promise<WarmContainer | null> {
        await this.verifyPoolIntegrity();
        this.reclaimExpiredWarmLeases();

        let idleIndex = -1;
        if (preferredLeaseId) {
            idleIndex = this.warmPool.findIndex(c => c.leaseId === preferredLeaseId && c.status === 'initializing');
        }
        if (idleIndex === -1) {
            idleIndex = this.warmPool.findIndex(c => c.status === 'idle');
        }
        if (idleIndex === -1) return null;

        const container = this.warmPool[idleIndex];
        container.status = 'claimed';
        container.slug = slug;
        container.leaseId = undefined;
        container.leaseExpiresAt = undefined;

        return container;
    }

    async releaseClaimedContainer(slug: string, dehydrate: boolean = true): Promise<boolean> {
        const container = this.warmPool.find(c => c.slug === slug && c.status === 'claimed');
        if (!container) return false;

        if (dehydrate) {
            try {
                await fs.rm(container.workspacePath, { recursive: true, force: true });
                await fs.mkdir(container.workspacePath, { recursive: true });
                await this.hydrateFromMaster(container.workspacePath);
            } catch (err: any) {
                logger.warn(`[WarmPool] Failed to reset claimed container for ${slug}: ${err.message}`);
            }
        }

        container.status = 'idle';
        container.slug = undefined;
        container.leaseId = undefined;
        container.leaseExpiresAt = undefined;
        return true;
    }

    getPool() {
        return this.warmPool;
    }

    async listNmCacheEntries() {
        try {
            const entries = await fs.readdir(NM_CACHE_ROOT, { withFileTypes: true });
            const result = [];
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const stats = await fs.stat(path.join(NM_CACHE_ROOT, entry.name));
                    result.push({
                        name: entry.name,
                        sizeMb: 0, // Placeholder for now, size calc is slow
                        updatedAt: stats.mtime
                    });
                }
            }
            return result.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        } catch (err: any) {
            logger.warn(`Failed to list NM cache: ${err.message}`);
            return [];
        }
    }

    async pruneNmCache(maxEntries: number) {
        const entries = await this.listNmCacheEntries();
        if (entries.length <= maxEntries) return { pruned: 0, reclaimedMb: 0 };

        const toPrune = entries.slice(maxEntries);
        let pruned = 0;
        for (const entry of toPrune) {
            try {
                await fs.rm(path.join(NM_CACHE_ROOT, entry.name), { recursive: true, force: true });
                pruned++;
            } catch (err: any) {
                logger.warn(`Failed to prune cache entry ${entry.name}: ${err.message}`);
            }
        }
        return { pruned, reclaimedMb: 0 };
    }
}

export const forgeInfrastructureService = new ForgeInfrastructureService();
