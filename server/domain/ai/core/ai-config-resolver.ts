import { resolveAiOrganization } from "./ai-org-context.js";
import { orgModelService } from "./org-model.service.js";
import { isOrgAiProviderId } from "@shared/org-ai-providers.js";
import { db } from "@server/database_service.js";
import { credentials, systemSettings, type SystemAiDefaults } from "@shared/schema/index.js";
import { eq, and, isNull } from "drizzle-orm";
import { type SystemServiceKey } from "./system-ai.service.js";

import { createLogger } from "@server/utils/logger.js";
import { type FallbackConfig, normalizeGeminiModel } from "@domain/ai/core/ai-client.service.js";
import { systemConfigService, type AiConfig as SystemAiConfig } from "@domain/system/system-config.service.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

const logger = createLogger("AiConfigResolver");

export interface AiConfig {
    provider: string;
    model: string;
    credentialId: number;
    apiKey: string;
    baseUrl?: string;
    timeoutMs?: number;
    maxTokens?: number;
}

export interface AiConfigWithFallback {
    primary: AiConfig;
    fallbacks: FallbackConfig[];
}

export const aiConfigResolver = {
    /**
     * Resolve AI configuration for an organization
     */
    async resolveOrgConfig(serviceKey: SystemServiceKey, orgId: number | null, isSuperAdmin: boolean = false): Promise<AiConfig | null> {
        return systemConfigService.resolveAiConfig(serviceKey, orgId);
    },


    /**
     * Resolve AI configuration for system-level services (concierge, copilot, etc.)
     */
    async resolveSystemConfig(serviceKey: SystemServiceKey): Promise<AiConfig | null> {
        return systemConfigService.resolveAiConfig(serviceKey);
    },


    /**
     * Resolve AI config with fallback chain for Multi-Model Fallback (AI_AGENT_ENHANCEMENTS_SPEC).
     * Returns primary config plus resolved fallback configs (provider, model, apiKey).
     */
    async resolveSystemConfigWithFallback(serviceKey: SystemServiceKey): Promise<AiConfigWithFallback | null> {
        const primary = await this.resolveSystemConfig(serviceKey);
        if (!primary) return null;

        // An org on its own key gets no platform fallbacks; everyone else keeps them.
        const aiOrg = await resolveAiOrganization();
        if (aiOrg !== null && await orgModelService.resolve(aiOrg)) return { primary, fallbacks: [] };

        const [settings] = await db.select().from(systemSettings).where(eq(systemSettings.key, "global")).limit(1);
        const data = (settings?.settingsData as any) || {};
        const defaults = data.systemAiDefaults as SystemAiDefaults | undefined;
        const serviceConfig = (defaults as any)?.[serviceKey] as { fallbackModels?: Array<{ provider: string; model: string }> } | undefined;

        const fallbackModels = serviceConfig?.fallbackModels;
        if (!fallbackModels || fallbackModels.length === 0) {
            return { primary, fallbacks: [] };
        }

        const allAiCreds = await db.select().from(credentials).where(and(eq(credentials.type, 'ai_provider'), isNull(credentials.organizationId)));
        const fallbacks: FallbackConfig[] = [];
        for (const fb of fallbackModels) {
            const cred = allAiCreds.find(c => (c.metadata as any)?.provider === fb.provider);
            if (cred) {
                const apiKey = (await resolveCredentialSecret(cred)) || "";
                if (apiKey) {
                    const fallbackModel = fb.provider === "google"
                        ? normalizeGeminiModel(fb.model)
                        : fb.model;

                    fallbacks.push({
                        provider: fb.provider,
                        model: fallbackModel,
                        apiKey,
                        baseUrl: (cred.metadata as any)?.baseUrl,
                    });
                }
            }
        }
        return { primary, fallbacks };
    },

    /**
     * Resolve a specific provider's credential by name (e.g. 'google', 'openai')
     * Primarily used for multi-model consensus where the task isn't bound to one organization's default.
     */
    async resolveProviderCredential(provider: string): Promise<AiConfig | null> {
        // An org that connected this provider answers with its own key; a
        // provider it has not connected, or an org without keys, uses the
        // platform's (none in production).
        const orgId = await resolveAiOrganization();
        if (orgId !== null && isOrgAiProviderId(provider)) {
            const own = await orgModelService.resolve(orgId, provider);
            if (own) return own;
        }
        try {
            const allAiCreds = await db.select().from(credentials).where(eq(credentials.type, 'ai_provider'));
            const providerCred = allAiCreds.find(c => (c.metadata as any)?.provider === provider);

            if (providerCred) {
                const apiKey = (await resolveCredentialSecret(providerCred));
                if (apiKey) {
                    return {
                        provider: provider,
                        model: (providerCred.metadata as any).model || 'gpt-4o',
                        credentialId: providerCred.id,
                        apiKey,
                        baseUrl: (providerCred.metadata as any).baseUrl
                    };
                }
            }
            
            // Fallback to environment variables if no DB entry
            const envKey = provider === 'google' ? developmentProviderKey() :
                           provider === 'openai' ? developmentProviderKey("openai") : undefined;
            
            if (envKey) {
                return {
                    provider,
                    model: provider === 'google' ? (process.env.GEMINI_MODEL || 'gemini-flash-latest') : 'gpt-4o',
                    credentialId: 0,
                    apiKey: envKey
                };
            }

            return null;
        } catch (error) {
            logger.error(`Failed to resolve provider credential for ${provider}`, error);
            return null;
        }
    }
};


