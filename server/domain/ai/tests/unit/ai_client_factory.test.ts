import { OrganizationAIClient } from "../../core/organization-ai-client.js";
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Unmock OpenAIClient before importing the actual class
vi.unmock('@server/domain/ai/core/providers/openai-client.ts');
vi.unmock('../../core/providers/openai-client.js');

import { AIClientFactory } from '../../core/ai-client.service.js';
import { AzureClient } from '../../core/providers/azure-client.js';
import { OpenAIClient } from '../../core/providers/openai-client.js';
import { AnthropicClient } from '../../core/providers/anthropic-client.js';

describe('AIClientFactory and Clients', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    describe('Factory Client Resolution', () => {
        it('should return correct clients for standard providers', () => {
            const openai = AIClientFactory.getClient({ name: 'openai', provider: 'openai' } as any);
            expect(openai).toBeInstanceOf(OrganizationAIClient);

            const anthropic = AIClientFactory.getClient({ name: 'anthropic', provider: 'anthropic' } as any);
            expect(anthropic).toBeInstanceOf(OrganizationAIClient);

            const azure = AIClientFactory.getClient({ name: 'azure', provider: 'azure' } as any);
            expect(azure).toBeInstanceOf(OrganizationAIClient);
        });
    });

    describe('AzureClient', () => {
        it('should correctly format azure endpoints and parse responses', async () => {
            const mockResponseData = {
                choices: [{
                    message: { content: 'Hello from Azure!' }
                }],
                usage: { total_tokens: 15, prompt_tokens: 5, completion_tokens: 10 }
            };

            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => mockResponseData,
                text: async () => JSON.stringify(mockResponseData)
            });

            vi.stubGlobal('fetch', mockFetch);

            const azureClient = new AzureClient({ apiEndpoint: 'https://test-azure.openai.azure.com/', apiVersion: '2024-02-01' });
            const response = await azureClient.execute(
                {
                    model: 'gpt-4o',
                    userPrompt: 'Hi',
                    temperature: 0.7,
                } as any,
                undefined,
                'test-api-key'
            );

            expect(response.success).toBe(true);
            expect(response.output).toBe('Hello from Azure!');
            expect(response.metadata?.tokensUsed).toBe(15);
            expect(response.metadata?.promptTokens).toBe(5);
            expect(response.metadata?.completionTokens).toBe(10);

            expect(mockFetch).toHaveBeenCalledWith(
                'https://test-azure.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-02-01',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'api-key': 'test-api-key',
                        'Content-Type': 'application/json'
                    })
                })
            );
        });

        it('should support multi-turn messages array', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ choices: [{ message: { content: 'Response' } }] }),
                text: async () => ''
            });

            vi.stubGlobal('fetch', mockFetch);

            const azureClient = new AzureClient({ apiEndpoint: 'https://test-azure.openai.azure.com/' });
            await azureClient.execute(
                {
                    model: 'gpt-4o',
                    userPrompt: 'This should be ignored if messages array is present',
                    messages: [
                        { role: 'user', content: 'Turn 1' },
                        { role: 'model', content: 'Reply 1' },
                        { role: 'user', content: 'Turn 2' }
                    ]
                } as any,
                undefined,
                'api-key'
            );

            const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(callBody.messages).toHaveLength(3);
            expect(callBody.messages[0]).toEqual({ role: 'user', content: 'Turn 1' });
            expect(callBody.messages[2]).toEqual({ role: 'user', content: 'Turn 2' });
        });
    });

    describe('OpenAIClient Multi-Turn Support', () => {
        it('should prioritize config.messages over config.userPrompt', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ choices: [{ message: { content: 'Response' } }] }),
                text: async () => ''
            });

            vi.stubGlobal('fetch', mockFetch);

            const openaiClient = new OpenAIClient();
            const response = await openaiClient.execute(
                {
                    model: 'gpt-4o',
                    userPrompt: 'Ignored prompt',
                    messages: [
                        { role: 'user', content: 'Real content' }
                    ]
                } as any,
                undefined,
                'api-key'
            );

            expect(response.success).toBe(true);

            const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(callBody.messages).toHaveLength(1);
            expect(callBody.messages[0]).toEqual({ role: 'user', content: 'Real content' });
        });
    });

    describe('AnthropicClient Multi-Turn Support', () => {
        it('should parse system prompt separately and map other messages', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ content: [{ text: 'Response' }] }),
                text: async () => ''
            });

            vi.stubGlobal('fetch', mockFetch);

            const anthropicClient = new AnthropicClient();
            await anthropicClient.execute(
                {
                    model: 'claude-3-opus',
                    userPrompt: 'Ignored',
                    messages: [
                        { role: 'system', content: 'System instruction' },
                        { role: 'user', content: 'Turn 1' }
                    ]
                } as any,
                undefined,
                'api-key'
            );

            const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(callBody.system).toBe('System instruction');
            expect(callBody.messages).toHaveLength(1);
            expect(callBody.messages[0]).toEqual({ role: 'user', content: 'Turn 1' });
        });
    });
});
