import { orgModelService } from "@domain/ai/core/org-model.service.js";
import { resolveAiOrganization } from "@domain/ai/core/ai-org-context.js";
import { db } from "@server/database_service.js";
import { systemSettings, orgSettings, missions } from "@shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";

import { createLogger } from "@server/utils/logger.js";
import { JOB_TYPE_CONFIG } from "@domain/jobs/ui/job-type-config.js";
import { SOUL_ARCHETYPES, OCEAN_LABELS } from "@domain/ai/ui/modules/agent-ai/soul-constants.js";
import { credentials, type SystemAiDefaults, systemAiDefaultsSchema } from "@shared/schema/index.js";
import { normalizeGeminiModel } from "@domain/ai/core/ai-client.service.js";
import { financialAlertService } from "./financial-alert.service.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";


export interface AiConfig {
    provider: string;
    model: string;
    credentialId: number;
    apiKey: string;
    baseUrl?: string;
    timeoutMs?: number;
}


const logger = createLogger("SystemConfigService");

export interface SystemConfig {
    jobTypes: typeof JOB_TYPE_CONFIG;
    soulConstants: {
        archetypes: string[];
        archetypeTraits: Record<string, any>;
        oceanLabels: typeof OCEAN_LABELS;
    };
    serviceUrls: {

        pythonService: string;
        predictiveService: string;
        ollama: string;
        qdrant: string;
    };
    theme: {
        healthColors: any;
        statusColors: any;
    };
}

export const systemConfigService = {
    /**
     * Get all global system settings with fallbacks
     */
    async getGlobalConfig(): Promise<SystemConfig> {
        try {
            const [settings] = await db.select().from(systemSettings).where(eq(systemSettings.key, "global")).limit(1);
            const data = (settings?.settingsData as any) || {};

            return {
                jobTypes: data.jobTypes || JOB_TYPE_CONFIG,
                soulConstants: data.soulConstants || {
                    archetypes: SOUL_ARCHETYPES,
                    archetypeTraits: {
                        "Lead Directive": { o: 0.6, c: 0.9, e: 0.7, a: 0.5, n: 0.2 },
                        "Ghost Analyst": { o: 0.9, c: 0.7, e: 0.2, a: 0.4, n: 0.3 },
                        "The Quartermaster": { o: 0.5, c: 0.95, e: 0.4, a: 0.8, n: 0.1 },
                        "Strategic Oracle": { o: 0.9, c: 0.8, e: 0.4, a: 0.5, n: 0.2 },
                        "Field Operative": { o: 0.4, c: 0.9, e: 0.8, a: 0.6, n: 0.3 },
                        "Tactical Analyst": { o: 0.7, c: 0.9, e: 0.3, a: 0.4, n: 0.2 },
                        "Creative Catalyst": { o: 0.95, c: 0.5, e: 0.8, a: 0.7, n: 0.4 },
                        "Data Sentinel": { o: 0.5, c: 0.98, e: 0.2, a: 0.5, n: 0.1 },
                        "Crisis Commander": { o: 0.6, c: 0.95, e: 0.9, a: 0.4, n: 0.2 },
                        "Knowledge Architect": { o: 0.85, c: 0.9, e: 0.4, a: 0.7, n: 0.1 },
                    },
                    oceanLabels: OCEAN_LABELS,
                },

                serviceUrls: data.serviceUrls || {
                    pythonService: process.env.PYTHON_SERVICE_URL || "http://localhost:8001",
                    predictiveService: process.env.PYTHON_SERVICE_URL || "http://localhost:8002",
                    ollama: "http://localhost:11434",
                    qdrant: "http://localhost:6333",
                },
                theme: data.theme || {
                    healthColors: {
                        excellent: { color: "#22c55e", bg: "#dcfce7", label: "Excellent" },
                        good: { color: "#84cc16", bg: "#ecfccb", label: "Good" },
                        fair: { color: "#eab308", bg: "#fef9c3", label: "Fair" },
                        poor: { color: "#f97316", bg: "#ffedd5", label: "Poor" },
                        critical: { color: "#ef4444", bg: "#fee2e2", label: "Critical" },
                    },
                    statusColors: {
                        active: { color: "#10b981", bg: "#ecfdf5" },
                        inactive: { color: "#6b7280", bg: "#f3f4f6" },
                        error: { color: "#ef4444", bg: "#fef2f2" },
                        warning: { color: "#f59e0b", bg: "#fffbeb" },
                        running: { color: "#3b82f6", bg: "#eff6ff" },
                    }
                }
            };
        } catch (error) {
            logger.error("Failed to fetch global system settings, using defaults", error);
            return this.getDefaultConfig();
        }
    },

    getDefaultConfig(): SystemConfig {
        return {
            jobTypes: JOB_TYPE_CONFIG,
            soulConstants: {
                archetypes: SOUL_ARCHETYPES,
                archetypeTraits: {
                    "Lead Directive": { o: 0.6, c: 0.9, e: 0.7, a: 0.5, n: 0.2 },
                    "Ghost Analyst": { o: 0.9, c: 0.7, e: 0.2, a: 0.4, n: 0.3 },
                    "The Quartermaster": { o: 0.5, c: 0.95, e: 0.4, a: 0.8, n: 0.1 },
                    "Strategic Oracle": { o: 0.9, c: 0.8, e: 0.4, a: 0.5, n: 0.2 },
                    "Field Operative": { o: 0.4, c: 0.9, e: 0.8, a: 0.6, n: 0.3 },
                    "Tactical Analyst": { o: 0.7, c: 0.9, e: 0.3, a: 0.4, n: 0.2 },
                    "Creative Catalyst": { o: 0.95, c: 0.5, e: 0.8, a: 0.7, n: 0.4 },
                    "Data Sentinel": { o: 0.5, c: 0.98, e: 0.2, a: 0.5, n: 0.1 },
                    "Crisis Commander": { o: 0.6, c: 0.95, e: 0.9, a: 0.4, n: 0.2 },
                    "Knowledge Architect": { o: 0.85, c: 0.9, e: 0.4, a: 0.7, n: 0.1 },
                },
                oceanLabels: OCEAN_LABELS,
            },
            serviceUrls: {

                pythonService: "http://localhost:8001",
                predictiveService: "http://localhost:8002",
                ollama: "http://localhost:11434",
                qdrant: "http://localhost:6333",
            },
            theme: {
                healthColors: {
                    excellent: { color: "#22c55e", bg: "#dcfce7", label: "Excellent" },
                    good: { color: "#84cc16", bg: "#ecfccb", label: "Good" },
                    fair: { color: "#eab308", bg: "#fef9c3", label: "Fair" },
                    poor: { color: "#f97316", bg: "#ffedd5", label: "Poor" },
                    critical: { color: "#ef4444", bg: "#fee2e2", label: "Critical" },
                },
                statusColors: {
                    active: { color: "#10b981", bg: "#ecfdf5" },
                    inactive: { color: "#6b7280", bg: "#f3f4f6" },
                    error: { color: "#ef4444", bg: "#fef2f2" },
                    warning: { color: "#f59e0b", bg: "#fffbeb" },
                    running: { color: "#3b82f6", bg: "#eff6ff" },
                }
            }
        };
    },

    /**
     * Resolve AI configuration for a specific service and organization
     */
    async resolveAiConfig(serviceKey: string, orgId: number | null = null): Promise<AiConfig | null> {
        orgId = await resolveAiOrganization(orgId);
        // An organization's own default connection, when it has one, wins.
        // Without one the org runs on the platform configuration below — the
        // per-org key is optional (a requirement here stopped AI for every org
        // that had not connected a key, including in development).
        if (orgId !== null) {
            const connection = await orgModelService.resolve(orgId);
            if (connection) return connection;
            if (process.env.NODE_ENV === "production") throw new Error("Connect your organization's AI provider key in Organization Settings before running AI work");
        }
        if (process.env.NODE_ENV === "production") throw new Error("Organization context is required for production AI execution");

        try {
            // Check for Local SLM routing for low-stakes tasks
            if (process.env.LOCAL_SLM_ENABLED === "true" && 
                ['concierge', 'faultAnalysis', 'threat_detector', 'compliance_officer', 'auditor'].includes(serviceKey)) {
                logger.info(`[SystemConfig] Routing low-stakes task "${serviceKey}" to local SLM`);
                return {
                    provider: 'ollama',
                    model: process.env.LOCAL_SLM_MODEL || 'llama3.2',
                    credentialId: 0,
                    apiKey: '',
                    baseUrl: process.env.LOCAL_SLM_BASE_URL || 'http://localhost:11434'
                };
            }

            // 1. Older per-org AI credential (credentials table + env var name).
            if (orgId !== null) {
                const [orgAiCred] = await db.select().from(credentials).where(and(
                    eq(credentials.type, 'ai_provider'),
                    eq(credentials.organizationId, orgId)
                )).limit(1);
                const metadata = orgAiCred?.metadata as any;
                const apiKey = orgAiCred ? (await resolveCredentialSecret(orgAiCred)) : undefined;
                if (orgAiCred && apiKey) {
                    const provider = metadata?.provider || 'google';
                    return {
                        provider,
                        model: provider === 'google'
                            ? normalizeGeminiModel(metadata?.model || process.env.GEMINI_MODEL || 'gemini-flash-latest')
                            : (metadata?.model || 'gpt-4o'),
                        credentialId: orgAiCred.id,
                        apiKey,
                        baseUrl: metadata?.baseUrl
                    };
                }
            }

            // 2. Check System Defaults (from 'global' settings)
            const [settings] = await db.select().from(systemSettings).where(eq(systemSettings.key, "global")).limit(1);
            let defaults: SystemAiDefaults | undefined;
            try {
                // Apply zod defaults so that local failovers and specific service defaults take effect
                defaults = systemAiDefaultsSchema.parse((settings?.settingsData as any)?.systemAiDefaults || {});
            } catch (err) {
                defaults = (settings?.settingsData as any)?.systemAiDefaults as SystemAiDefaults | undefined;
            }

            if (defaults && (defaults as any)[serviceKey]) {
                const serviceDefault = (defaults as any)[serviceKey];
                const allAiCreds = await db.select().from(credentials).where(and(eq(credentials.type, 'ai_provider'), sql`${credentials.organizationId} IS NULL`));
                const providerCred = allAiCreds.find(c => (c.metadata as any)?.provider === serviceDefault.provider);

                if (providerCred) {
                    const apiKey = (await resolveCredentialSecret(providerCred));
                    if (apiKey) {
                        const provider = serviceDefault.provider;
                        return {
                            provider,
                            model: provider === 'google'
                                ? normalizeGeminiModel(serviceDefault.model || (providerCred.metadata as any).model || 'gpt-4o')
                                : (serviceDefault.model || (providerCred.metadata as any).model || 'gpt-4o'),
                            credentialId: providerCred.id,
                            apiKey,
                            baseUrl: (providerCred.metadata as any).baseUrl,
                            timeoutMs: serviceDefault.timeoutMs
                        };
                    }
                }
            }

            // 3. Final Fallback: the platform's keys — development only, since
            // production returned or threw on the organization's key above.
            const envKey = developmentProviderKey() || developmentProviderKey("openai");
            if (envKey) {
                const provider = developmentProviderKey() ? 'google' : 'openai';
                return {
                    provider,
                    model: provider === 'google'
                        ? normalizeGeminiModel(process.env.AI_MODEL || 'gemini-flash-latest')
                        : (process.env.AI_MODEL || 'gpt-4o'),
                    credentialId: 0,
                    apiKey: envKey
                };
            }

            return null;
        } catch (error) {
            logger.error(`Failed to resolve AI config for ${serviceKey}`, error);
            return null;
        }
    },

    /**
     * Track and enforce spend for an organization and/or mission.
     * Also writes a granular record to cost_ledger for per-agent attribution.
     */
    async trackSpend(
        amount: number,
        orgId: number | null,
        missionId: number | null,
        ledgerMeta?: {
            model?: string;
            provider?: string;
            tokensPrompt?: number;
            tokensCompletion?: number;
            agentDeploymentId?: number | null;
            sessionId?: string;
        }
    ): Promise<{ allowed: boolean, reason?: string }> {
        try {
            // 1. Mission Check
            if (missionId) {
                const [mission] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
                if (mission) {
                    const currentSpend = parseFloat(mission.currentSpendUsd?.toString() || "0");
                    const limit = parseFloat(mission.budgetLimitUsd?.toString() || "5.00");
                    
                    if (currentSpend >= limit) {
                        logger.warn(`Mission ${missionId} budget reached/exceeded: Spent $${currentSpend} / Limit $${limit}`);
                        // Trigger immediate kill-switch alert
                        financialAlertService.sendKillSwitchAlert(mission.organizationId as number, mission.id.toString(), currentSpend, limit).catch(err => {
                            logger.error(`Failed to send mission kill-switch alert: ${err.message}`);
                        });
                        return { allowed: false, reason: `Mission budget exceeded ($${limit})` };
                    }


                    if (amount > 0) {
                        const newSpend = currentSpend + amount;
                        await db.update(missions).set({
                            currentSpendUsd: newSpend.toFixed(4)
                        }).where(eq(missions.id, missionId));
                    }
                }
            }

            // 2. Organization Check
            if (orgId) {
                const [settings] = await db.select().from(orgSettings).where(eq(orgSettings.organizationId, orgId)).limit(1);
                if (settings) {
                    const currentOrgSpend = parseFloat(settings.currentMonthSpendUsd?.toString() || "0");
                    const orgLimit = parseFloat(settings.monthlyBudgetUsd?.toString() || "100.00");
                    
                    if (currentOrgSpend >= orgLimit) {
                        logger.warn(`Organization ${orgId} budget reached/exceeded: Spent $${currentOrgSpend} / Limit $${orgLimit}`);
                        // Trigger immediate kill-switch alert for organization
                        financialAlertService.sendThresholdAlert(orgId as number, 100, currentOrgSpend, orgLimit).catch(err => {
                            logger.error(`Failed to send organization 100% threshold alert: ${err.message}`);
                        });
                        return { allowed: false, reason: `Organization monthly budget exceeded ($${orgLimit})` };
                    }


                    if (amount > 0) {
                        const newOrgSpend = currentOrgSpend + amount;
                        await db.update(orgSettings).set({
                            currentMonthSpendUsd: newOrgSpend.toFixed(4),
                            updatedAt: new Date()
                        }).where(eq(orgSettings.organizationId, orgId));
                    }
                }
            }

            // 3. Granular cost ledger entry (non-blocking — fire-and-forget)
            if (amount > 0 && orgId) {
                const { costLedgerService } = await import("./cost-ledger.service.js");
                costLedgerService.record({
                    orgId,
                    missionId: missionId ?? undefined,
                    agentDeploymentId: ledgerMeta?.agentDeploymentId ?? undefined,
                    sessionId: ledgerMeta?.sessionId,
                    // Never invent attribution. These defaulted to model
                    // "unknown" / provider "openai" / zero tokens, and because
                    // no caller passed ledgerMeta, all 132 recorded rows claimed
                    // an OpenAI call with no tokens — on a Gemini-first platform.
                    // A row that cannot say what it paid for is still worth
                    // recording for the total, but it must say so.
                    model: ledgerMeta?.model ?? "unknown",
                    provider: ledgerMeta?.provider ?? "unknown",
                    tokensPrompt: ledgerMeta?.tokensPrompt ?? 0,
                    tokensCompletion: ledgerMeta?.tokensCompletion ?? 0,
                    costUsd: String(amount.toFixed(6)),
                }).catch((e: any) => logger.warn(`Cost ledger record failed: ${e.message}`));
            }

            return { allowed: true };
        } catch (error) {

            logger.error("Failed to track spend", error);
            // On database failure, we fail-open for now but log the error
            return { allowed: true };
        }
    }
};

