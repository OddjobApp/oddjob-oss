import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIClientFactory } from './ai-client.service.js';
import { aiHealingService } from './ai-healing.service.js';
import { aiDebuggingService } from './ai-debugging.service.js';

// Mock the AI Client to prevent actual API calls during tests
vi.mock('./ai-client.service.js', async (importOriginal) => {
    const original = await importOriginal();
    return {
        ...(original as any),
        AIClientFactory: {
            getClient: vi.fn((providerMeta) => {
                const provider = (providerMeta as any).provider;
                const supported = ["openai", "openai_dalle", "dalle", "anthropic", "google", "midjourney", "mock", "ollama"];
                if (!supported.includes(provider)) {
                    throw new Error(`Unsupported AI provider: ${provider}`);
                }
                return {
                    execute: vi.fn(async (config) => {
                        if (config.userPrompt?.includes('Fix this malformed JSON')) {
                            return { success: true, output: '{"fixed": true}' };
                        }
                        if (config.userPrompt?.includes('broken CSS/XPath selector') || config.userPrompt?.includes('Repair a broken')) {
                            return { success: true, output: '.healed-selector' };
                        }
                        return { success: true, output: 'Mock AI Response' };
                    })
                };
            })
        }
    };
});

// The healing path resolves its provider through the org/system AI config,
// which is backed by the credentials and system_settings tables. Stub the
// resolver so this stays a unit test; the AI call itself is mocked above.
vi.mock('@domain/ai/core/ai-config-resolver.js', () => ({
    aiConfigResolver: {
        resolveSystemConfig: vi.fn(async () => ({
            provider: 'mock',
            model: 'mock-model',
            credentialId: 0,
            apiKey: 'mock-key',
        })),
    },
}));

describe('AI Pod Diagnostic Eval', () => {

    describe('AIClientFactory', () => {
        it('should resolve the correct client for supported providers', () => {
            const google = AIClientFactory.getClient({ provider: 'google' } as any);
            expect(google).toBeDefined();
            
            const openai = AIClientFactory.getClient({ provider: 'openai' } as any);
            expect(openai).toBeDefined();
        });

        it('should throw for unsupported providers', () => {
            expect(() => AIClientFactory.getClient({ provider: 'mystic-ai' } as any)).toThrow();
        });
    });

    describe('AIHealingService', () => {
        it('should heal broken selectors', async () => {
            const healed = await aiHealingService.healSelector('.broken', '<html></html>', 'Error');
            expect(healed).toBe('.healed-selector');
        });

        it('should heal malformed JSON', async () => {
            const healed = await aiHealingService.healJson('{ missing: "quotes" }', 'test');
            expect(healed).toBe('{"fixed": true}');
            expect(JSON.parse(healed!)).toEqual({ fixed: true });
        });
    });

    describe('AiDebuggingService', () => {
        it('should use healing service to fix JSON', async () => {
            const result = await aiDebuggingService.fixJson('context', '{bad}', null);
            expect(result.success).toBe(true);
            expect(result.fixedJson).toBe('{"fixed": true}');
            expect(result.method).toBe('ai');
        });
    });
});
