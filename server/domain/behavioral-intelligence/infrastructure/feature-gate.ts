/**
 * Behavioral Intelligence Engine — Feature Gate
 *
 * Controls access to the Behavioral Intelligence Engine based on org tier.
 * Premium feature: disabled by default, enabled per-org by super-admin.
 *
 * Tiers:
 * - starter: 5 vectors, 20 rules, 3 thresholds, 10K events/day, 1 API key
 * - pro: Unlimited vectors/rules, 10 thresholds, 100K events/day, 5 API keys, prediction tuning
 * - enterprise: Unlimited everything, custom decay, cross-org, SLA guarantees
 */
import { db } from "@server/database_service.js";
import { orgSettings } from "@shared/schema/auth.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("BIFeatureGate");

export type BITier = "starter" | "pro" | "enterprise";

export interface TierLimits {
  vectors: number;        // -1 = unlimited
  rules: number;
  thresholds: number;
  eventsPerDay: number;
  apiKeys: number;
  predictionTuning: boolean;
  customDecay: boolean;
  crossOrgScoring: boolean;
  pathDiscovery: boolean;
  abTesting: boolean;
  environmentalContext: boolean;
}

export const TIER_LIMITS: Record<BITier, TierLimits> = {
  starter: {
    vectors: 5,
    rules: 20,
    thresholds: 3,
    eventsPerDay: 10_000,
    apiKeys: 1,
    predictionTuning: false,
    customDecay: false,
    crossOrgScoring: false,
    pathDiscovery: false,
    abTesting: false,
    environmentalContext: false,
  },
  pro: {
    vectors: -1,
    rules: -1,
    thresholds: 10,
    eventsPerDay: 100_000,
    apiKeys: 5,
    predictionTuning: true,
    customDecay: false,
    crossOrgScoring: false,
    pathDiscovery: true,
    abTesting: true,
    environmentalContext: true,
  },
  enterprise: {
    vectors: -1,
    rules: -1,
    thresholds: -1,
    eventsPerDay: -1,
    apiKeys: -1,
    predictionTuning: true,
    customDecay: true,
    crossOrgScoring: true,
    pathDiscovery: true,
    abTesting: true,
    environmentalContext: true,
  },
};

export class FeatureDisabledError extends Error {
  constructor(message = "Behavioral Intelligence is not enabled for this organization") {
    super(message);
    this.name = "FeatureDisabledError";
  }
}

export class TierLimitError extends Error {
  public resource: string;
  public limit: number;
  public tier: BITier;

  constructor(resource: string, limit: number, tier: BITier) {
    super(`Tier limit exceeded: ${resource} is capped at ${limit} on the "${tier}" plan`);
    this.name = "TierLimitError";
    this.resource = resource;
    this.limit = limit;
    this.tier = tier;
  }
}

// Cache org tier lookups (TTL 60s)
const tierCache = new Map<number, { tier: BITier | null; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

/**
 * Get the Behavioral Intelligence tier for an org.
 * Returns null if the feature is not enabled.
 */
export async function getOrgTier(orgId: number): Promise<BITier | null> {
  const now = Date.now();
  const cached = tierCache.get(orgId);
  if (cached && cached.expiresAt > now) return cached.tier;

  const [settings] = await db.select({ tier: (orgSettings as any).behavioralIntelligenceTier })
    .from(orgSettings)
    .where(eq(orgSettings.organizationId, orgId))
    .limit(1);

  const tier = (settings as any)?.tier as BITier | null ?? null;
  tierCache.set(orgId, { tier, expiresAt: now + CACHE_TTL_MS });
  return tier;
}

/**
 * Check if an org has access to the Behavioral Intelligence Engine.
 * Throws FeatureDisabledError if not enabled.
 */
export async function requireBI(orgId: number): Promise<BITier> {
  const tier = await getOrgTier(orgId);
  if (!tier) throw new FeatureDisabledError();
  return tier;
}

/**
 * Check a specific resource limit for the org's tier.
 * Throws TierLimitError if the limit would be exceeded.
 */
export async function checkLimit(orgId: number, resource: keyof TierLimits, currentCount?: number): Promise<void> {
  const tier = await requireBI(orgId);
  const limits = TIER_LIMITS[tier];
  const limit = limits[resource];

  if (typeof limit === "boolean") {
    if (!limit) throw new TierLimitError(resource, 0, tier);
    return;
  }

  if (limit === -1) return; // unlimited
  if (currentCount !== undefined && currentCount >= limit) {
    throw new TierLimitError(resource, limit as number, tier);
  }
}

/**
 * Get the full limits object for an org's tier.
 */
export async function getLimits(orgId: number): Promise<TierLimits> {
  const tier = await requireBI(orgId);
  return TIER_LIMITS[tier];
}

/**
 * Invalidate the tier cache for an org (called when super-admin changes tier).
 */
export function invalidateTierCache(orgId: number): void {
  tierCache.delete(orgId);
}

/**
 * Check if a specific capability is available for the org's tier.
 */
export async function hasCapability(orgId: number, capability: keyof TierLimits): Promise<boolean> {
  const tier = await getOrgTier(orgId);
  if (!tier) return false;
  const value = TIER_LIMITS[tier][capability];
  return typeof value === "boolean" ? value : value !== 0;
}
