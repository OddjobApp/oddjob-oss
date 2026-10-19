/**
 * AI Config Resolver Unit Tests
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// Helper to create a chainable mock query
const createMockQuery = (result: any = []) => {
    const query = {
        returning: vi.fn().mockResolvedValue(result),
        then: (onFulfilled: any) => Promise.resolve(result).then(onFulfilled),
        limit: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
    };
    return query;
};

// Mock database
vi.mock("@server/database_service.js", () => {
    return {
        db: {
            select: vi.fn(() => createMockQuery([])),
        },
    };
});

vi.mock("@server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    })),
}));

vi.mock("@domain/ai/core/org-model.service.js", () => ({ orgModelService: { resolve: vi.fn() } }));
import { orgModelService } from "@domain/ai/core/org-model.service.js";
import { aiConfigResolver } from "@domain/ai/core/ai-config-resolver.js";
import { db } from "@server/database_service.js";

describe("AiConfigResolver", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.unstubAllEnvs();
        vi.resetAllMocks();
        // Clear AI-related env vars for clean state
        delete process.env.AI_PROVIDER;
        delete process.env.AI_MODEL;
        delete process.env.GEMINI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        delete process.env.LOCAL_SLM_ENABLED;
    });

    describe("resolveOrgConfig", () => {
        it("resolves the encrypted organization connection", async () => {
            vi.mocked(orgModelService.resolve).mockResolvedValue({ provider: "google", model: "gemini-2.5-flash", apiKey: "org-key", credentialId: 0 });
            expect((await aiConfigResolver.resolveOrgConfig('concierge', 1))?.apiKey).toBe("org-key");
            expect(orgModelService.resolve).toHaveBeenCalledWith(1);
        });

        it("never falls back to platform keys when an organization is disconnected", async () => {
            vi.stubEnv("NODE_ENV", "production");
            process.env.GEMINI_API_KEY = "platform-key";
            vi.mocked(orgModelService.resolve).mockResolvedValue(null);
            await expect(aiConfigResolver.resolveOrgConfig('concierge', 1)).rejects.toThrow("Connect your organization");
        });

        it("should resolve org config when orgId is null via env fallback", async () => {
            (db.select as Mock).mockReturnValue(createMockQuery([]));
            process.env.GEMINI_API_KEY = "sk-null-org";

            const config = await aiConfigResolver.resolveOrgConfig('concierge', null);

            expect(config?.apiKey).toBe('sk-null-org');
            delete process.env.GEMINI_API_KEY;
        });

        it("fails closed when organization storage is unavailable", async () => {
            vi.mocked(orgModelService.resolve).mockRejectedValue(new Error("storage unavailable"));
            await expect(aiConfigResolver.resolveOrgConfig('concierge', 1)).rejects.toThrow("storage unavailable");
        });
    });

    describe("resolveSystemConfig", () => {
        it("should resolve from system settings", async () => {
            const mockSettings = {
                key: 'global',
                settingsData: {
                    systemAiDefaults: {
                        concierge: { provider: 'google', model: 'gemini-pro' }
                    }
                }
            };
            const mockCred = {
                id: 5,
                type: 'ai_provider',
                envVarName: 'SYSTEM_GP_KEY',
                metadata: { provider: 'google' }
            };
            process.env.SYSTEM_GP_KEY = "sys-key";

            // Multi-step resolution
            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery([mockSettings]))
                .mockReturnValueOnce(createMockQuery([mockCred]));

            const config = await aiConfigResolver.resolveSystemConfig('concierge');
            expect(config?.model).toBe('gemini-2.5-flash'); // normalizeGeminiModel maps gemini-pro → gemini-2.5-flash
            expect(config?.credentialId).toBe(5);
        });

        it("should fall back to environment variables", async () => {
            (db.select as Mock).mockReturnValue(createMockQuery([])); // No settings
            process.env.AI_PROVIDER = "openai";
            process.env.OPENAI_API_KEY = "sk-env";

            const config = await aiConfigResolver.resolveSystemConfig('concierge');
            expect(config?.provider).toBe('openai');
            expect(config?.apiKey).toBe("sk-env");
        });

        it("should return null when no config available", async () => {
            (db.select as Mock).mockReturnValue(createMockQuery([]));
            delete process.env.GEMINI_API_KEY;
            delete process.env.OPENAI_API_KEY;

            const config = await aiConfigResolver.resolveSystemConfig('copilot');

            expect(config).toBeNull();
        });

        it("should resolve faultAnalysis service key", async () => {
            const mockSettings = {
                key: 'global',
                settingsData: {
                    systemAiDefaults: {
                        faultAnalysis: { provider: 'anthropic', model: 'claude-3' }
                    }
                }
            };
            const mockCred = {
                id: 7,
                type: 'ai_provider',
                envVarName: 'FAULT_KEY',
                metadata: { provider: 'anthropic' }
            };
            process.env.FAULT_KEY = "sk-fault";
            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery([mockSettings]))
                .mockReturnValueOnce(createMockQuery([mockCred]));

            const config = await aiConfigResolver.resolveSystemConfig('faultAnalysis');

            expect(config?.provider).toBe('anthropic');
            expect(config?.model).toBe('claude-3');
        });
    });

    describe("resolveSystemConfigWithFallback", () => {
        it("should return fallback chain", async () => {
            process.env.GEMINI_API_KEY = "primary-key";
            process.env.SECONDARY_KEY = "secondary-key";

            const mockSettings = {
                key: 'global',
                settingsData: {
                    systemAiDefaults: {
                        concierge: {
                            provider: 'google',
                            fallbackModels: [{ provider: 'openai', model: 'gpt-4' }]
                        }
                    }
                }
            };
            const mockCred = {
                id: 20,
                type: 'ai_provider',
                envVarName: 'SECONDARY_KEY',
                metadata: { provider: 'openai' }
            };

            // Call sequence:
            // 1. resolveSystemConfig -> select systemSettings
            // 2. resolveSystemConfig -> select credentials
            // 3. select systemSettings (again, for fallbacks)
            // 4. select credentials (again, for fallbacks)
            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery([mockSettings])) // resolveSystemConfig -> settings
                .mockReturnValueOnce(createMockQuery([]))           // resolveSystemConfig -> credentials (no matching for primary, use env)
                .mockReturnValueOnce(createMockQuery([mockSettings])) // resolveSystemConfigWithFallback -> settings
                .mockReturnValueOnce(createMockQuery([mockCred]));   // resolveSystemConfigWithFallback -> credentials

            const config = await aiConfigResolver.resolveSystemConfigWithFallback('concierge');

            expect(config?.primary.provider).toBe('google');
            expect(config?.fallbacks).toHaveLength(1);
            expect(config?.fallbacks[0].provider).toBe('openai');
            expect(config?.fallbacks[0].apiKey).toBe('secondary-key');
        });
    });
});
