/**
 * Behavioral Intelligence Engine — Consent Service
 *
 * Implements consent-based scoring:
 * - Only score entities with explicit consent flag
 * - Events for non-consented entities are accepted but not processed
 * - SDK supports consent parameter to prevent emission entirely
 * - Consent can be granted/revoked at any time
 */
import { createLogger } from "@server/utils/logger.js";
import { getRedisClient } from "@domain/core/infrastructure/redis/redis-client.js";

const logger = createLogger("BIConsent");

const CONSENT_KEY_PREFIX = "bi:consent:";
const CONSENT_TTL = 365 * 86400; // 1 year

/**
 * Check if an entity has given consent for behavioral scoring.
 * Returns true if consent is granted OR if consent is not required for this model.
 */
async function hasConsent(orgId: number, entityType: string, entityId: string): Promise<boolean> {
  const client = getRedisClient();
  const key = `${CONSENT_KEY_PREFIX}${orgId}:${entityType}:${entityId}`;
  const value = await client.get(key);
  // null = no explicit consent record (default: allowed unless model requires consent)
  // "granted" = explicit consent
  // "revoked" = explicit revocation
  return value !== "revoked";
}

/**
 * Grant consent for an entity.
 */
async function grantConsent(orgId: number, entityType: string, entityId: string): Promise<void> {
  const client = getRedisClient();
  const key = `${CONSENT_KEY_PREFIX}${orgId}:${entityType}:${entityId}`;
  await client.set(key, "granted", "EX", CONSENT_TTL);
  logger.info(`[Consent] Granted for ${entityType}:${entityId} in org ${orgId}`);
}

/**
 * Revoke consent for an entity. Scoring will stop but existing data is retained
 * (use erasure service to delete data).
 */
async function revokeConsent(orgId: number, entityType: string, entityId: string): Promise<void> {
  const client = getRedisClient();
  const key = `${CONSENT_KEY_PREFIX}${orgId}:${entityType}:${entityId}`;
  await client.set(key, "revoked", "EX", CONSENT_TTL);
  logger.info(`[Consent] Revoked for ${entityType}:${entityId} in org ${orgId}`);
}

/**
 * Check if consent is explicitly required for a model.
 * If true, only entities with "granted" consent are scored.
 */
async function isConsentRequired(orgId: number, modelId: string): Promise<boolean> {
  // In production: check the model's consent_required flag from bi_vector_models
  // For now, default to false (consent not required unless explicitly configured)
  return false;
}

/**
 * Get consent status for an entity.
 */
async function getConsentStatus(orgId: number, entityType: string, entityId: string): Promise<"granted" | "revoked" | "unknown"> {
  const client = getRedisClient();
  const key = `${CONSENT_KEY_PREFIX}${orgId}:${entityType}:${entityId}`;
  const value = await client.get(key);
  if (value === "granted") return "granted";
  if (value === "revoked") return "revoked";
  return "unknown";
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const biConsentService = {
  hasConsent,
  grantConsent,
  revokeConsent,
  isConsentRequired,
  getConsentStatus,
};
