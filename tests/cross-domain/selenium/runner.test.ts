import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SeleniumRunner } from "@domain/mission/selenium/runner.js";
import { aiHealingService } from '../../../server/domain/ai/core/ai-healing.service.js';
import { AIClientFactory } from '../../../server/domain/ai/core/ai-client.service.js';
import { systemAiService } from '../../../server/domain/ai/core/system-ai.service.js';

vi.mock('../../../server/domain/ai/core/ai-healing.service.js');
vi.mock('../../../server/domain/ai/core/ai-client.service.js');
vi.mock('../../../server/domain/ai/core/system-ai.service.js');

/**
 * The runner takes its page from strategy.init(config) — LocalBrowserStrategy
 * unless the config asks for the grid. Stubbing `(runner as any).getPage`
 * intercepted nothing, so both tests launched real Playwright and drove
 * example.com: the healing case spent 64 seconds failing to click a selector
 * on a live page. Both strategies are stubbed here so the suite tests the
 * runner rather than the internet.
 */
const { strategyPage } = vi.hoisted(() => ({ strategyPage: { current: null as any } }));

vi.mock('../../../server/domain/mission/selenium/strategies/local.js', () => ({
    LocalBrowserStrategy: class {
        async init() {
            return { page: strategyPage.current, cleanup: async () => {} };
        }
    },
}));

vi.mock('../../../server/domain/mission/selenium/strategies/grid.js', () => ({
    GridBrowserStrategy: class {
        async init() {
            return { page: strategyPage.current, cleanup: async () => {} };
        }
    },
}));

describe('SeleniumRunner', () => {
    let runner: SeleniumRunner;
    let mockPage: any;
    let mockBrowser: any;

    beforeEach(() => {
        runner = new SeleniumRunner();
        mockPage = {
            goto: vi.fn(),
            click: vi.fn(),
            fill: vi.fn(),
            textContent: vi.fn().mockResolvedValue('Test Content'),
            content: vi.fn().mockResolvedValue('<html><body>Test Content</body></html>'),
            evaluate: vi.fn().mockResolvedValue('Test Content'),
            url: vi.fn().mockReturnValue('https://example.com'),
            title: vi.fn().mockResolvedValue('Test Page'),
            close: vi.fn(),
            waitForSelector: vi.fn(),
            waitForLoadState: vi.fn(),
            setDefaultTimeout: vi.fn(),
            setDefaultNavigationTimeout: vi.fn(),
            context: vi.fn().mockReturnValue({
                cookies: vi.fn().mockResolvedValue([]),
                addCookies: vi.fn(),
                close: vi.fn(),
            }),
            screenshot: vi.fn().mockResolvedValue(Buffer.from('')),
            $: vi.fn()
        };
        strategyPage.current = mockPage;
        mockBrowser = {
            newPage: vi.fn().mockResolvedValue(mockPage),
            close: vi.fn()
        };
        // Mock playwright launch if needed, but here we assume internal methods are mocked or runner uses a factory
    });

    /**
     * executeSmartScrape was a stub — its body was a note saying to copy the
     * extraction logic from an original that is not in this repository — so an
     * extractAI step logged and extracted nothing. It is implemented now
     * against the client the factory actually returns: execute(config, input,
     * apiKey) answering { success, output }. The double here previously used
     * generateStructured, which exists only on the constitutional-AI client.
     */
    it('should execute extractAI step using AIClientFactory', async () => {
        const mockAIClient = {
            execute: vi.fn().mockResolvedValue({
                success: true,
                output: JSON.stringify({ test_key: 'value' }),
            }),
        };
        vi.mocked(AIClientFactory.getClient).mockReturnValue(mockAIClient as any);
        vi.mocked(systemAiService.getAiConfig).mockResolvedValue({
            model: 'test-model',
            apiKey: 'test-key',
        } as any);

        const config = {
            steps: [
                { action: 'goto', value: 'https://example.com' },
                { action: 'extractAI', aiPrompt: 'Extract data', extractAs: 'test_key' }
            ]
        };

        // We need to bypass the actual playwright launch for unit tests or mock it
        // For this test, let's mock the internal executeStep or the page object
        
        // Mocking the page methods for the runner
        (runner as any).getPage = vi.fn().mockResolvedValue(mockPage);

        const result = await runner.execute(config as any, {} as any);

        expect(result.success).toBe(true);
        expect(result.extracted.test_key).toEqual({ test_key: 'value' });
        expect(mockAIClient.execute).toHaveBeenCalled();
        // The page's text reaches the model, and JSON is asked for explicitly.
        const [callConfig] = mockAIClient.execute.mock.calls[0];
        expect(callConfig.responseType).toBe('json');
        expect(callConfig.userPrompt).toContain('Extract data');
    });

    it('should execute click with healing when enabled', async () => {
        const config = {
            healingEnabled: true,
            steps: [
                { action: 'goto', value: 'https://example.com' },
                { action: 'click', selector: '#missing-btn' }
            ]
        };

        (runner as any).getPage = vi.fn().mockResolvedValue(mockPage);
        
        // Simulate initial failure, then success after healing
        mockPage.click.mockRejectedValueOnce(new Error('Selector not found'));
        mockPage.click.mockResolvedValueOnce(undefined);

        vi.mocked(aiHealingService.healSelector).mockResolvedValue('#healed-btn');

        const result = await runner.execute(config as any, {} as any);

        expect(result.success).toBe(true);
        expect(aiHealingService.healSelector).toHaveBeenCalled();
        expect(mockPage.click).toHaveBeenCalledWith('#healed-btn', expect.any(Object));
    });
});
