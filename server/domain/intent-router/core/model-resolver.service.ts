/**
 * Model Binding Resolver Service
 * Resolves the target LLM provider and model for a given agent card,
 * checking circuit breaker status and falling back to org defaults when needed.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.5
 */

import { asc, eq, and, or, isNull } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import {
  llmProviderHealth,
  llmProviders,
  llmModels,
} from "@shared/schema/ai/llm-router.js";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";
import { orgModelService } from "@domain/ai/core/org-model.service.js";
import { ORG_AI_PROVIDERS } from "@shared/org-ai-providers.js";

const logger = createLogger("ModelResolverService");

// ============================================================================
// TYPES
// ============================================================================

export interface ModelResolutionResult {
  /** The llm_providers / llm_models rows; null when the org's own connected key decides. */
  providerId: number | null;
  modelId: number | null;
  providerName: string;
  /** Technical provider name used by llm-router (e.g. "openai", "anthropic") */
  providerTechnicalName: string;
  modelIdentifier: string;
  isFallback: boolean;
  fallbackReason?: string;
}

// ============================================================================
// SERVICE
// ============================================================================

export class ModelResolverService {
  /** Cards already reported as unbound, so the notice is not repeated per round. */
  private static readonly unboundCardsWarned = new Set<number>();

  /**
   * Resolves the model binding for a given agent card.
   * Checks provider health via circuit breaker status and falls back
   * to org default provider if the primary is unavailable.
   *
   * @throws Error if both primary and fallback providers are unavailable (for 503 response)
   */
  async resolve(agentCard: AgentCardRecord, orgId: number): Promise<ModelResolutionResult> {
    // An organization that connected its own key runs every call on it: the LLM
    // router ignores the preferred provider for such an org. Resolve to that
    // connection, so a card binding or registry default can neither block the
    // call (CREW refused to speak for an org whose only AI was its own key) nor
    // misreport which model answered.
    const connection = await orgModelService.resolve(orgId).catch((error) => {
      logger.error(`Error resolving the connected AI key for org ${orgId}:`, error);
      return null;
    });
    if (connection) {
      return {
        providerId: null,
        modelId: null,
        providerName: ORG_AI_PROVIDERS[connection.provider].label,
        providerTechnicalName: connection.provider,
        modelIdentifier: connection.model,
        isFallback: false,
      };
    }

    const primaryProviderId = agentCard.modelBindingProviderId;
    const primaryModelId = agentCard.modelBindingModelId;

    // If agent card has no model binding configured, go straight to org default
    if (!primaryProviderId || !primaryModelId) {
      // Once per card, not once per round. An unbound card is a normal,
      // supported configuration — the org default exists for it — but warning
      // on every turn buried the log and trained readers to skip a line that
      // matters: the identical wording appears when the org default is ALSO
      // missing, which is a genuine outage and how crew chat failed for org 291.
      if (!ModelResolverService.unboundCardsWarned.has(agentCard.id)) {
        ModelResolverService.unboundCardsWarned.add(agentCard.id);
        logger.warn(
          `Agent card ${agentCard.id} ("${agentCard.name}") has no model binding configured; ` +
            `using the org default. Bind a model on the card to silence this — logged once per card.`,
        );
      }
      return this.resolveFromOrgDefault(orgId, "Agent card has no model binding configured");
    }

    // Check primary provider health
    const primaryHealthy = await this.checkProviderHealth(primaryProviderId);

    if (primaryHealthy) {
      // Primary provider is healthy — resolve its details. getProviderDetails
      // is org-scoped: a card bound to another org's provider/model cannot
      // resolve foreign credentials, it falls through to the org default.
      const providerDetails = await this.getProviderDetails(primaryProviderId, primaryModelId, orgId);
      if (providerDetails) {
        return {
          providerId: primaryProviderId,
          modelId: primaryModelId,
          providerName: providerDetails.providerName,
          providerTechnicalName: providerDetails.providerTechnicalName,
          modelIdentifier: providerDetails.modelIdentifier,
          isFallback: false,
        };
      }

      // Provider/model record not found (shouldn't happen if FK constraints hold)
      logger.warn(
        `Provider ${primaryProviderId} or model ${primaryModelId} record not found, falling back`,
      );
      return this.resolveFromOrgDefault(orgId, "Primary provider or model record not found");
    }

    // Primary provider is unhealthy — fall back to org default
    logger.info(
      `Provider ${primaryProviderId} is unhealthy (circuit open or down), falling back to org default`,
    );
    return this.resolveFromOrgDefault(orgId, "Primary provider circuit breaker open or status down");
  }

  /**
   * Checks whether a provider is healthy by examining the llmProviderHealth table.
   * A provider is considered unhealthy if circuitOpen === true OR status === 'down'.
   */
  private async checkProviderHealth(providerId: number): Promise<boolean> {
    try {
      const [health] = await db
        .select({
          circuitOpen: llmProviderHealth.circuitOpen,
          circuitOpenUntil: llmProviderHealth.circuitOpenUntil,
          status: llmProviderHealth.status,
        })
        .from(llmProviderHealth)
        .where(eq(llmProviderHealth.providerId, providerId))
        .limit(1);

      // If no health record exists, assume healthy (no data = no known issues)
      if (!health) {
        return true;
      }

      // An open circuit is only open until circuitOpenUntil — past that the
      // breaker is meant to half-open and let a probe through. Checking the
      // flag alone kept a provider skipped forever after a transient outage:
      // an Anthropic key that ran out of credits and was topped up stayed
      // "down" to every resolution until someone edited the row by hand. The
      // probe overrides the stored "down" status too — that status is set by
      // the same failure streak that opened the circuit, so honoring it here
      // would make the expiry dead code. If the probe call fails, health
      // tracking opens the circuit again.
      if (health.circuitOpen === true) {
        return (
          health.circuitOpenUntil !== null &&
          health.circuitOpenUntil.getTime() <= Date.now()
        );
      }
      if (health.status === "down") {
        return false;
      }

      return true;
    } catch (error) {
      logger.error(`Error checking provider health for provider ${providerId}:`, error);
      // On error reading health, assume healthy to avoid unnecessary fallback
      return true;
    }
  }

  /**
   * Gets the org's default provider and model.
   * Looks for an llmModel marked as isDefault=true for the given org,
   * then resolves its provider.
   */
  private async getOrgDefaultProvider(
    orgId: number,
  ): Promise<{ providerId: number; modelId: number } | null> {
    try {
      const [defaultModel] = await db
        .select({
          modelId: llmModels.id,
          providerId: llmModels.providerId,
        })
        .from(llmModels)
        .innerJoin(llmProviders, eq(llmModels.providerId, llmProviders.id))
        .where(
          and(
            or(eq(llmModels.organizationId, orgId), isNull(llmModels.organizationId)),
            eq(llmModels.isDefault, true),
            eq(llmModels.isActive, true),
            eq(llmProviders.isActive, true),
          ),
        )
        // Org-scoped default wins over a global (NULL-org) default. Postgres
        // sorts NULLs last under ASC, so asc() is what expresses that — desc()
        // would put the global row first.
        .orderBy(asc(llmModels.organizationId))
        .limit(1);

      if (!defaultModel) {
        return null;
      }

      return {
        providerId: defaultModel.providerId,
        modelId: defaultModel.modelId,
      };
    } catch (error) {
      logger.error(`Error fetching org default provider for org ${orgId}:`, error);
      return null;
    }
  }

  /**
   * Resolves provider name and model identifier from the database.
   */
  private async getProviderDetails(
    providerId: number,
    modelId: number,
    orgId: number,
  ): Promise<{ providerName: string; providerTechnicalName: string; modelIdentifier: string } | null> {
    try {
      const [result] = await db
        .select({
          providerName: llmProviders.displayName,
          providerTechnicalName: llmProviders.name,
          modelIdentifier: llmModels.modelId,
        })
        .from(llmModels)
        .innerJoin(llmProviders, eq(llmModels.providerId, llmProviders.id))
        .where(
          and(
            eq(llmProviders.id, providerId),
            eq(llmModels.id, modelId),
            // Tenant boundary: allow organization-specific provider/model rows,
            // or global system-level rows (organizationId is null).
            or(eq(llmProviders.organizationId, orgId), isNull(llmProviders.organizationId)),
            or(eq(llmModels.organizationId, orgId), isNull(llmModels.organizationId)),
          ),
        )
        .limit(1);

      return result || null;
    } catch (error) {
      logger.error(`Error fetching provider details for provider ${providerId}, model ${modelId}:`, error);
      return null;
    }
  }

  /**
   * Attempts to resolve from the org's default provider.
   * If the default provider is unavailable, falls back to any active healthy provider for the org.
   * If no providers are healthy, throws an error for a 503 response.
   */
  private async resolveFromOrgDefault(
    orgId: number,
    fallbackReason: string,
  ): Promise<ModelResolutionResult> {
    const orgDefault = await this.getOrgDefaultProvider(orgId);

    if (orgDefault) {
      // Check if the default provider is healthy
      const fallbackHealthy = await this.checkProviderHealth(orgDefault.providerId);
      if (fallbackHealthy) {
        const details = await this.getProviderDetails(orgDefault.providerId, orgDefault.modelId, orgId);
        if (details) {
          return {
            providerId: orgDefault.providerId,
            modelId: orgDefault.modelId,
            providerName: details.providerName,
            providerTechnicalName: details.providerTechnicalName,
            modelIdentifier: details.modelIdentifier,
            isFallback: true,
            fallbackReason,
          };
        }
      }
      logger.warn(
        `Org default provider ${orgDefault.providerId} is unhealthy or missing details for org ${orgId}. Searching for alternative healthy provider.`,
      );
    }

    // Secondary fallback: find ANY active model for the org whose provider is healthy
    const alternative = await this.getAlternativeHealthyProvider(orgId);
    if (alternative) {
      const details = await this.getProviderDetails(alternative.providerId, alternative.modelId, orgId);
      if (details) {
        logger.info(
          `Fell back to alternative healthy provider ${alternative.providerId} (${details.providerName}) for org ${orgId}`,
        );
        return {
          providerId: alternative.providerId,
          modelId: alternative.modelId,
          providerName: details.providerName,
          providerTechnicalName: details.providerTechnicalName,
          modelIdentifier: details.modelIdentifier,
          isFallback: true,
          fallbackReason: `${fallbackReason}; default provider unavailable`,
        };
      }
    }

    if (!orgDefault) {
      throw new Error(
        `No available model provider: primary provider unavailable and no org default configured for org ${orgId}. Reason: ${fallbackReason}`,
      );
    }

    throw new Error(
      `No available model provider: both primary and org default provider (${orgDefault.providerId}) are unavailable for org ${orgId}. Reason: ${fallbackReason}`,
    );
  }

  /**
   * Finds an alternative active model for the org whose provider is healthy.
   */
  private async getAlternativeHealthyProvider(
    orgId: number,
  ): Promise<{ providerId: number; modelId: number } | null> {
    try {
      const activeModels = await db
        .select({
          modelId: llmModels.id,
          providerId: llmModels.providerId,
        })
        .from(llmModels)
        .innerJoin(llmProviders, eq(llmModels.providerId, llmProviders.id))
        .where(
          and(
            or(eq(llmModels.organizationId, orgId), isNull(llmModels.organizationId)),
            eq(llmModels.isActive, true),
            eq(llmProviders.isActive, true),
          ),
        )
        // priority: lower number = higher routing priority, so asc(). Org-scoped
        // rows before global (NULL-org) rows: Postgres puts NULLs last under ASC.
        .orderBy(asc(llmModels.priority), asc(llmModels.organizationId));

      for (const m of activeModels) {
        if (!(await this.checkProviderHealth(m.providerId))) continue;
        // The row must actually resolve for this org — a healthy provider whose
        // details fail the tenant filter is skipped, not returned to the caller
        // to throw on.
        if (await this.getProviderDetails(m.providerId, m.modelId, orgId)) {
          return { providerId: m.providerId, modelId: m.modelId };
        }
      }
      return null;
    } catch (error) {
      logger.error(`Error finding alternative healthy provider for org ${orgId}:`, error);
      return null;
    }
  }
}

// Singleton instance
export const modelResolverService = new ModelResolverService();
