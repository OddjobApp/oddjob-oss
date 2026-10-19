/**
 * Deployment Profile Service
 *
 * Maps a hardware tier to concrete runtime constraints and LLM routing hints.
 * Callers (mission orchestrator, rolling-wave, workers) query this service to
 * get tuned values instead of hard-coding production-only limits.
 *
 * Profiles
 * --------
 *  laptop      8-16 GB RAM, CPU / optional small GPU (dev/trial)
 *  workstation 32-64 GB RAM, 1-2 dedicated GPUs (power-user)
 *  server      64-256 GB RAM, 2-8 GPUs (on-prem production)
 *  cluster     Multi-node GPU cluster / cloud-burst (enterprise scale)
 *
 * Usage
 * -----
 *   import { deploymentProfileService } from './deployment-profile.service.js';
 *
 *   const profile = await deploymentProfileService.getForOrg(orgId);
 *   const concurrency = profile.missionConcurrency;
 *   const maxTok = profile.maxTokensPerRequest;
 */

import { createLogger } from '@server/utils/logger.js';
import { cacheService } from '@domain/cache/cache.service.js';
import type { DeploymentProfile } from '@shared/schema/auth.js';

const logger = createLogger('DeploymentProfileService');

// ---------------------------------------------------------------------------
// Profile specification type
// ---------------------------------------------------------------------------

export interface ProfileSpec {
    /** Max simultaneous mission/cycle runs for this org */
    missionConcurrency: number;
    /** Default max tokens per LLM request */
    maxTokensPerRequest: number;
    /** Preferred routing strategy for this profile */
    defaultRoutingStrategy: 'cost' | 'speed' | 'quality' | 'predictive';
    /** Whether local/on-prem models should be preferred */
    preferLocalModels: boolean;
    /** Whether heavy fine-tuning features are enabled */
    fineTuningEnabled: boolean;
    /** Max parallel tool executions within a single step */
    maxParallelTools: number;
    /** SSE streaming chunk size (chars) */
    streamingChunkSize: number;
    /** Human-readable label */
    label: string;
}

// ---------------------------------------------------------------------------
// Static profile catalogue
// ---------------------------------------------------------------------------

export const PROFILE_CATALOGUE: Record<DeploymentProfile, ProfileSpec> = {
    laptop: {
        label: 'Laptop (Dev/Trial)',
        missionConcurrency: 1,
        maxTokensPerRequest: 4096,
        defaultRoutingStrategy: 'cost',
        preferLocalModels: false,
        fineTuningEnabled: false,
        maxParallelTools: 2,
        streamingChunkSize: 64,
    },
    workstation: {
        label: 'Workstation (Power-User)',
        missionConcurrency: 3,
        maxTokensPerRequest: 8192,
        defaultRoutingStrategy: 'predictive',
        preferLocalModels: true,
        fineTuningEnabled: false,
        maxParallelTools: 4,
        streamingChunkSize: 128,
    },
    server: {
        label: 'On-Prem Server',
        missionConcurrency: 8,
        maxTokensPerRequest: 32768,
        defaultRoutingStrategy: 'quality',
        preferLocalModels: true,
        fineTuningEnabled: true,
        maxParallelTools: 8,
        streamingChunkSize: 256,
    },
    cluster: {
        label: 'GPU Cluster / Cloud-Burst',
        missionConcurrency: 20,
        maxTokensPerRequest: 128000,
        defaultRoutingStrategy: 'predictive',
        preferLocalModels: false, // Can burst to cloud
        fineTuningEnabled: true,
        maxParallelTools: 16,
        streamingChunkSize: 512,
    },
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class DeploymentProfileService {

    /**
     * Resolve the effective ProfileSpec for an org, merging any per-org overrides.
     * Result is cached for 5 minutes.
     */
    async getForOrg(orgId: number): Promise<ProfileSpec> {
        const cacheKey = `deployment_profile:org:${orgId}`;
        return cacheService.getOrFetch(cacheKey, async () => {
            return this.loadFromDb(orgId);
        }, { ttl: 300 });
    }

    /**
     * Get profile spec for a known profile name (without DB lookup).
     * Useful for preview / UI without an org context.
     */
    get(profile: DeploymentProfile, overrides?: Partial<ProfileSpec>): ProfileSpec {
        const base = { ...PROFILE_CATALOGUE[profile] };
        if (overrides) {
            return { ...base, ...overrides };
        }
        return base;
    }

    /**
     * Invalidate a cached org profile (call after settings update).
     */
    async invalidate(orgId: number): Promise<void> {
        await cacheService.invalidate(`deployment_profile:org:${orgId}`);
    }

    /**
     * Convenience: return max mission concurrency for an org.
     * Callers that only need this single value avoid loading the full spec.
     */
    async getMissionConcurrency(orgId: number): Promise<number> {
        const spec = await this.getForOrg(orgId);
        return spec.missionConcurrency;
    }

    /**
     * Convenience: return max tokens per request for an org.
     */
    async getMaxTokens(orgId: number): Promise<number> {
        const spec = await this.getForOrg(orgId);
        return spec.maxTokensPerRequest;
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private async loadFromDb(orgId: number): Promise<ProfileSpec> {
        try {
            const { db } = await import('@server/database_service.js');
            const { orgSettings } = await import('@shared/schema/index.js');
            const { eq } = await import('drizzle-orm');

            const rows = await db
                .select({
                    deploymentProfile: orgSettings.deploymentProfile,
                    deploymentProfileOverrides: orgSettings.deploymentProfileOverrides,
                    missionConcurrency: orgSettings.missionConcurrency,
                })
                .from(orgSettings)
                .where(eq(orgSettings.organizationId, orgId))
                .limit(1);

            if (rows.length === 0) {
                logger.debug(`[DeploymentProfile] No settings found for org ${orgId}, using 'laptop' defaults.`);
                return { ...PROFILE_CATALOGUE.laptop };
            }

            const row = rows[0];
            const profile = (row.deploymentProfile ?? 'laptop') as DeploymentProfile;
            const base = { ...PROFILE_CATALOGUE[profile] };

            // DB-level missionConcurrency always wins over profile default
            if (row.missionConcurrency) {
                base.missionConcurrency = row.missionConcurrency;
            }

            // Merge JSONB overrides (partial ProfileSpec)
            const overrides = row.deploymentProfileOverrides as Partial<ProfileSpec> | null;
            if (overrides && typeof overrides === 'object') {
                Object.assign(base, overrides);
            }

            logger.debug(`[DeploymentProfile] Org ${orgId}: profile=${profile}, concurrency=${base.missionConcurrency}`);
            return base;
        } catch (err: any) {
            logger.warn(`[DeploymentProfile] DB lookup failed for org ${orgId}: ${err.message}. Falling back to laptop.`);
            return { ...PROFILE_CATALOGUE.laptop };
        }
    }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const deploymentProfileService = new DeploymentProfileService();
