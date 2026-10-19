/**
 * LLM Provider Repository
 * Handles database operations for LLM providers and models
 */

import { db } from "@server/database_service.js";
import { llmProviders, llmModels, llmProviderHealth } from "@shared/schema/ai/llm-router.js";
import { eq, and, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("LLMProviderRepository");

export const llmProviderRepository = {
    // === Provider Operations ===

    async findProviderById(id: number) {
        const [provider] = await db
            .select()
            .from(llmProviders)
            .where(eq(llmProviders.id, id))
            .limit(1);
        return provider;
    },

    async findProviderByName(name: string) {
        const [provider] = await db
            .select()
            .from(llmProviders)
            .where(eq(llmProviders.name, name))
            .limit(1);
        return provider;
    },

    async findActiveProviders() {
        return db
            .select()
            .from(llmProviders)
            .where(eq(llmProviders.isActive, true))
            .orderBy(desc(llmProviders.priority));
    },

    async findAllProviders() {
        return db
            .select()
            .from(llmProviders)
            .orderBy(desc(llmProviders.priority));
    },

    async createProvider(data: any) {
        const [provider] = await db
            .insert(llmProviders)
            .values(data)
            .returning();
        logger.info(`Created LLM provider: ${provider.name} (${provider.id})`);
        return provider;
    },

    async updateProvider(id: number, data: any) {
        const [provider] = await db
            .update(llmProviders)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(llmProviders.id, id))
            .returning();
        return provider;
    },

    async deleteProvider(id: number) {
        await db.delete(llmProviders).where(eq(llmProviders.id, id));
        logger.info(`Deleted LLM provider: ${id}`);
    },

    // === Model Operations ===

    async findModelById(id: number) {
        const [model] = await db
            .select()
            .from(llmModels)
            .where(eq(llmModels.id, id))
            .limit(1);
        return model;
    },

    async findModelByProviderAndModelId(providerId: number, modelId: string) {
        const [model] = await db
            .select()
            .from(llmModels)
            .where(and(
                eq(llmModels.providerId, providerId),
                eq(llmModels.modelId, modelId)
            ))
            .limit(1);
        return model;
    },

    async findActiveModelsByProvider(providerId: number) {
        return db
            .select()
            .from(llmModels)
            .where(and(
                eq(llmModels.providerId, providerId),
                eq(llmModels.isActive, true)
            ))
            .orderBy(desc(llmModels.priority));
    },

    async findModelsByCapability(capability: string) {
        // This would require a JSON query for capabilities array
        // Simplified version - fetch all active and filter in code
        return db
            .select()
            .from(llmModels)
            .where(eq(llmModels.isActive, true));
    },

    async createModel(data: any) {
        const [model] = await db
            .insert(llmModels)
            .values(data)
            .returning();
        logger.info(`Created LLM model: ${model.modelId} (${model.id})`);
        return model;
    },

    async updateModel(id: number, data: any) {
        const [model] = await db
            .update(llmModels)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(llmModels.id, id))
            .returning();
        return model;
    },

    async deleteModel(id: number) {
        await db.delete(llmModels).where(eq(llmModels.id, id));
        logger.info(`Deleted LLM model: ${id}`);
    },

    // === Health Operations ===

    async findHealthByProviderId(providerId: number) {
        const [health] = await db
            .select()
            .from(llmProviderHealth)
            .where(eq(llmProviderHealth.providerId, providerId))
            .limit(1);
        return health;
    },

    async createOrUpdateHealth(providerId: number, data: any) {
        const existing = await this.findHealthByProviderId(providerId);

        if (existing) {
            const [health] = await db
                .update(llmProviderHealth)
                .set({
                    ...data,
                    lastCheckedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(llmProviderHealth.providerId, providerId))
                .returning();
            return health;
        } else {
            const [health] = await db
                .insert(llmProviderHealth)
                .values({
                    providerId,
                    ...data,
                    lastCheckedAt: new Date(),
                })
                .returning();
            return health;
        }
    },

    async updateProviderHealth(providerId: number, success: boolean, latencyMs: number) {
        const health = await this.findHealthByProviderId(providerId);

        const consecutiveFailures = success ? 0 : (((health?.consecutiveFailures ?? 0) || 0) + 1);
        const requestsCount = ((health?.requestsCount ?? 0) || 0) + 1;
        const errorsCount = ((health?.errorsCount ?? 0) || 0) + (success ? 0 : 1);
        const successRate = ((requestsCount - errorsCount) / requestsCount) * 100;

        // Calculate new average latency
        const avgLatencyMs = health
            ? Math.round(((health.avgLatencyMs ?? 0) * (health.requestsCount ?? 0) + latencyMs) / requestsCount)
            : latencyMs;

        // Determine status
        let status = "healthy";
        if (!health) {
            status = success ? "healthy" : "degraded";
        } else if (consecutiveFailures >= 5) {
            status = "down";
        } else if (consecutiveFailures >= 3) {
            status = "degraded";
        } else if (successRate < 95) {
            status = "degraded";
        }

        return this.createOrUpdateHealth(providerId, {
            successRate,
            avgLatencyMs,
            consecutiveFailures,
            requestsCount,
            errorsCount,
            status,
        });
    },
};
