/**
 * Intent-to-Pipeline Mapper tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPipelineList = vi.fn();
const mockGetAiConfig = vi.fn();
const mockExecute = vi.fn();

vi.mock('@domain/pipeline/core/pipeline.service.js', () => ({
    pipelineService: {
        list: (...args: unknown[]) => mockPipelineList(...args),
    },
}));

vi.mock('@domain/ai/core/system-ai.service.js', () => ({
    systemAiService: {
        getAiConfig: (...args: unknown[]) => mockGetAiConfig(...args),
    },
}));

vi.mock('@domain/ai/core/ai-client.service.js', () => ({
    AIClientFactory: {
        getClient: () => ({
            execute: (...args: unknown[]) => mockExecute(...args),
        }),
    },
}));

vi.mock('@server/utils/logger.js', () => ({
    createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('Intent Pipeline Mapper', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('mapIntentToPipeline exists and is a function', async () => {
        const { mapIntentToPipeline } = await import('@server/domain/pipeline/core/intent-pipeline-mapper.service.js');
        expect(typeof mapIntentToPipeline).toBe('function');
    });

    it('returns null when no pipelines available', async () => {
        mockPipelineList.mockResolvedValue([]);
        mockGetAiConfig.mockResolvedValue({ apiKey: 'key', provider: 'google', model: 'gemini' });

        const { mapIntentToPipeline } = await import('@server/domain/pipeline/core/intent-pipeline-mapper.service.js');
        const result = await mapIntentToPipeline('Run JIRA analysis', 1);

        expect(result).toBeNull();
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('returns null when AI config has no apiKey', async () => {
        mockPipelineList.mockResolvedValue([{ id: 1, name: 'JIRA Sync', description: 'Syncs JIRA' }]);
        mockGetAiConfig.mockResolvedValue({ provider: 'google', model: 'gemini' });

        const { mapIntentToPipeline } = await import('@server/domain/pipeline/core/intent-pipeline-mapper.service.js');
        const result = await mapIntentToPipeline('Run JIRA analysis', 1);

        expect(result).toBeNull();
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('returns pipelineId when LLM returns valid match', async () => {
        mockPipelineList.mockResolvedValue([
            { id: 10, name: 'JIRA Analysis', description: 'Runs JIRA analysis' },
            { id: 20, name: 'Slack Post', description: 'Posts to Slack' },
        ]);
        mockGetAiConfig.mockResolvedValue({
            apiKey: 'key',
            provider: 'google',
            model: 'gemini',
            baseUrl: '',
        });
        mockExecute.mockResolvedValue({
            success: true,
            output: '{"pipelineId": 10, "confidence": 0.9, "inputHints": {"project": "PROJ"}}',
        });

        const { mapIntentToPipeline } = await import('@server/domain/pipeline/core/intent-pipeline-mapper.service.js');
        const result = await mapIntentToPipeline('Run JIRA analysis', 1);

        expect(result).not.toBeNull();
        expect(result!.pipelineId).toBe(10);
        expect(result!.confidence).toBe(0.9);
        expect(result!.inputHints).toEqual({ project: 'PROJ' });
    });

    it('returns null when LLM returns low confidence', async () => {
        mockPipelineList.mockResolvedValue([{ id: 10, name: 'JIRA', description: '' }]);
        mockGetAiConfig.mockResolvedValue({ apiKey: 'key', provider: 'google', model: 'gemini', baseUrl: '' });
        mockExecute.mockResolvedValue({
            success: true,
            output: '{"pipelineId": 10, "confidence": 0.3}',
        });

        const { mapIntentToPipeline } = await import('@server/domain/pipeline/core/intent-pipeline-mapper.service.js');
        const result = await mapIntentToPipeline('Do something vague', 1);

        expect(result).toBeNull();
    });

    it('returns null when LLM returns pipelineId not in allowed list', async () => {
        mockPipelineList.mockResolvedValue([{ id: 10, name: 'JIRA', description: '' }]);
        mockGetAiConfig.mockResolvedValue({ apiKey: 'key', provider: 'google', model: 'gemini', baseUrl: '' });
        mockExecute.mockResolvedValue({
            success: true,
            output: '{"pipelineId": 99, "confidence": 0.9}',
        });

        const { mapIntentToPipeline } = await import('@server/domain/pipeline/core/intent-pipeline-mapper.service.js');
        const result = await mapIntentToPipeline('Run JIRA', 1, [10]);

        expect(result).toBeNull();
    });
});
