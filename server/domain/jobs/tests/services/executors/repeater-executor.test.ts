/**
 * Repeater Executor tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecuteCurlJob = vi.fn();

vi.mock("@domain/core/infrastructure/http-executor.service.js", () => ({
    executeCurlJob: (...args: unknown[]) => mockExecuteCurlJob(...args),
}));

import { RepeaterExecutor } from "@domain/jobs/core/executors/repeater-executor.js";
import type { Job, Pipeline } from "@shared/schema/index.js";

const executor = new RepeaterExecutor();

const mockJob: Job = {
    id: 1,
    name: 'Repeater Job',
    type: 'repeater',
    config: {},
    organizationId: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
} as unknown as Job;

const mockPipeline: Pipeline = {
    id: 1,
    name: 'Test Pipeline',
    organizationId: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
} as unknown as Pipeline;

const baseContext = {
    named: {} as Record<string, string>,
    positional: {} as Record<number, string>,
};

describe('RepeaterExecutor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockExecuteCurlJob.mockResolvedValue('{"result":"ok"}');
    });

    it('canExecute returns true for repeater', () => {
        expect(executor.canExecute('repeater')).toBe(true);
    });

    it('canExecute returns false for other types', () => {
        expect(executor.canExecute('curl')).toBe(false);
    });

    it('iterates over inputSource array and calls nested job', async () => {
        const config = {
            inputSource: [1, 2, 3],
            itemVariable: 'item',
            nestedJobConfig: {
                method: 'GET',
                url: 'https://api.example.com/{{item}}',
            },
        };

        const result = await executor.execute(mockJob, config, mockPipeline, baseContext);

        expect(result.success).toBe(true);
        expect(result.status).toBe('success');
        expect(mockExecuteCurlJob).toHaveBeenCalledTimes(3);

        const output = JSON.parse(result.output as string);
        expect(output).toHaveLength(3);
        expect(output[0]).toEqual({ status: 'success', output: '{"result":"ok"}', item: 1 });
        expect(output[1]).toEqual({ status: 'success', output: '{"result":"ok"}', item: 2 });
        expect(output[2]).toEqual({ status: 'success', output: '{"result":"ok"}', item: 3 });
    });

    it('respects maxIterations limit', async () => {
        const config = {
            inputSource: [1, 2, 3, 4, 5],
            maxIterations: 2,
            itemVariable: 'item',
            nestedJobConfig: { method: 'GET', url: 'https://api.example.com' },
        };

        const result = await executor.execute(mockJob, config, mockPipeline, baseContext);

        expect(result.success).toBe(true);
        expect(mockExecuteCurlJob).toHaveBeenCalledTimes(2);
        const output = JSON.parse(result.output as string);
        expect(output).toHaveLength(2);
    });

    it('parses JSON string inputSource', async () => {
        const config = {
            inputSource: '[{"id":1},{"id":2}]',
            itemVariable: 'item',
            nestedJobConfig: { method: 'GET', url: 'https://api.example.com' },
        };

        const result = await executor.execute(mockJob, config, mockPipeline, baseContext);

        expect(result.success).toBe(true);
        expect(mockExecuteCurlJob).toHaveBeenCalledTimes(2);
        const output = JSON.parse(result.output as string);
        expect(output[0].item).toEqual({ id: 1 });
        expect(output[1].item).toEqual({ id: 2 });
    });

    it('handles iteration failure and continues', async () => {
        mockExecuteCurlJob
            .mockResolvedValueOnce('ok')
            .mockRejectedValueOnce(new Error('API failed'))
            .mockResolvedValueOnce('ok');

        const config = {
            inputSource: [1, 2, 3],
            itemVariable: 'item',
            nestedJobConfig: { method: 'GET', url: 'https://api.example.com' },
        };

        const result = await executor.execute(mockJob, config, mockPipeline, baseContext);

        expect(result.success).toBe(true);
        const output = JSON.parse(result.output as string);
        expect(output[0].status).toBe('success');
        expect(output[1].status).toBe('failure');
        expect(output[1].error).toBe('API failed');
        expect(output[2].status).toBe('success');
    });

    it('handles empty inputSource', async () => {
        const config = {
            inputSource: [],
            nestedJobConfig: { method: 'GET', url: 'https://api.example.com' },
        };

        const result = await executor.execute(mockJob, config, mockPipeline, baseContext);

        expect(result.success).toBe(true);
        expect(mockExecuteCurlJob).not.toHaveBeenCalled();
        const output = JSON.parse(result.output as string);
        expect(output).toEqual([]);
    });
});
