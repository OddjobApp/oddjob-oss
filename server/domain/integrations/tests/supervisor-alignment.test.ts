import { describe, it, expect, vi } from 'vitest';
import { supervisorService } from '../core/supervisor.service.js';
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";

vi.mock("@domain/ai/core/system-ai.service.js", () => ({
    systemAiService: {
        getAiConfig: vi.fn()
    }
}));

vi.mock("@domain/ai/core/ai-client.service.js", () => ({
    AIClientFactory: {
        getClient: vi.fn()
    }
}));

describe('SupervisorService Alignment', () => {
    it('should pass orgId to systemAiService.getAiConfig and use resolved config', async () => {
        const mockConfig = {
            provider: 'google',
            model: 'gemini-2.0-flash',
            apiKey: 'mock-gemini-key',
            baseUrl: 'https://gemini.api'
        };
        (systemAiService.getAiConfig as any).mockResolvedValue(mockConfig);

        const mockClient = {
            execute: vi.fn().mockResolvedValue({
                success: true,
                output: JSON.stringify({
                    tasks: [],
                    intent: 'test intent',
                    statusUpdate: 'Planning...'
                })
            })
        };
        (AIClientFactory.getClient as any).mockReturnValue(mockClient);

        const plan = await supervisorService.plan('test intent', undefined, undefined, '', '', undefined, '', 123);

        // Verify orgId propagation
        expect(systemAiService.getAiConfig).toHaveBeenCalledWith('copilot', 123);

        // Verify client initialization uses resolved provider
        expect(AIClientFactory.getClient).toHaveBeenCalledWith({
            provider: 'google',
            baseUrl: 'https://gemini.api'
        });

        // Verify execution uses resolved apiKey and model
        expect(mockClient.execute).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'gemini-2.0-flash'
            }),
            undefined,
            'mock-gemini-key'
        );

        expect(plan.intent).toBe('test intent');
    });

    it('should throw error if no AI provider is found', async () => {
        (systemAiService.getAiConfig as any).mockResolvedValue(null);

        await expect(supervisorService.plan('test intent', undefined, undefined, '', '', undefined, '', 123))
            .rejects.toThrow("No valid AI Provider found for Supervisor");
    });
});


