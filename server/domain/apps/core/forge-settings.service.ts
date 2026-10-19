import { redis } from "@domain/core/infrastructure/redis/redis-client.js";

const FORGE_SETTINGS_TTL = 3600 * 24 * 30; // 30 days

export interface ForgeSettings {
    coding: {
        typescriptStrict: boolean;
        eslintRuleset: string;
        requireTests: boolean;
        coverageThreshold: number;
        preferReactQuery: boolean;
        stateManagement: string;
        blockedPackages: string[];
        allowedPackages: string[];
    };
    security: {
        owaspLevel: string;
        blockHardcodedSecrets: boolean;
        requireAuth: boolean;
        requireZodValidation: boolean;
        requireRateLimiting: boolean;
        generateCSPHeaders: boolean;
    };
    ai: {
        verbosity: string;
        enableArchitectureReview: boolean;
        enableStrategyReview: boolean;
        maxRetryAttempts: number;
        defaultBlueprint: string;
        systemPromptSuffix: string;
    };
    rag: {
        autoIncludeOrgKnowledge: boolean;
        defaultReferenceAssetIds: number[];
        semanticSearchThreshold: number;
    };
    updatedAt: string | null;
    updatedBy: number | null;
}

export class ForgeSettingsService {
    static getDefaults(): ForgeSettings {
        return {
            coding: {
                typescriptStrict: true,
                eslintRuleset: "airbnb",
                requireTests: false,
                coverageThreshold: 70,
                preferReactQuery: true,
                stateManagement: "react-query",
                blockedPackages: [],
                allowedPackages: [],
            },
            security: {
                owaspLevel: "owasp-top-10",
                blockHardcodedSecrets: true,
                requireAuth: false,
                requireZodValidation: true,
                requireRateLimiting: false,
                generateCSPHeaders: false,
            },
            ai: {
                verbosity: "balanced",
                enableArchitectureReview: true,
                enableStrategyReview: true,
                maxRetryAttempts: 3,
                defaultBlueprint: "analytics-dashboard",
                systemPromptSuffix: "",
            },
            rag: {
                autoIncludeOrgKnowledge: false,
                defaultReferenceAssetIds: [],
                semanticSearchThreshold: 0.7,
            },
            updatedAt: null,
            updatedBy: null,
        };
    }

    async getSettings(orgId: number): Promise<ForgeSettings> {
        const raw = await redis.get(`forge:settings:org:${orgId}`);
        if (!raw) return ForgeSettingsService.getDefaults();
        try {
            const parsed = JSON.parse(raw);
            const defaults = ForgeSettingsService.getDefaults();
            return {
                ...defaults,
                ...parsed,
                coding: { ...defaults.coding, ...(parsed.coding || {}) },
                security: { ...defaults.security, ...(parsed.security || {}) },
            };
        } catch {
            return ForgeSettingsService.getDefaults();
        }
    }

    async saveSettings(orgId: number, settings: Partial<ForgeSettings>, userId?: number): Promise<void> {
        const current = await this.getSettings(orgId);
        const updated = {
            ...current,
            ...settings,
            updatedAt: new Date().toISOString(),
            updatedBy: userId ?? null
        };
        await redis.setex(`forge:settings:org:${orgId}`, FORGE_SETTINGS_TTL, JSON.stringify(updated));
    }

    /**
     * Converts settings into a concise markdown block for AI system prompt injection.
     */
    toPromptContext(settings: ForgeSettings): string {
        const parts = [
            "### FORGE GOVERNANCE & STANDARDS",
            `- TypeScript: ${settings.coding.typescriptStrict ? "Strict mode MANDATORY" : "Standard"}`,
            `- Coding Style: ${settings.coding.eslintRuleset}`,
            `- Security Level: ${settings.security.owaspLevel}`,
            `- Requirement: ${settings.security.requireZodValidation ? "Mandatory Zod schema validation for all API inputs" : "Standard validation"}`,
            settings.ai.systemPromptSuffix ? `- Additional Policy: ${settings.ai.systemPromptSuffix}` : ""
        ];

        return parts.filter(Boolean).join("\n");
    }
}

export const forgeSettingsService = new ForgeSettingsService();
