/**
 * Transformer Executor tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecuteTransformations = vi.fn();

vi.mock("@domain/pipeline/core/transformation-engine.service.js", () => ({
    TransformationEngine: class MockTransformationEngine {
        executeTransformations(...args: unknown[]) {
            return mockExecuteTransformations(...args);
        }
    },
}));

import { TransformerExecutor } from "@domain/jobs/core/executors/transformer-executor.js";

describe('TransformerExecutor', () => {
    const executor = new TransformerExecutor();

    beforeEach(() => {
        vi.clearAllMocks();
        mockExecuteTransformations.mockResolvedValue({ transformed: true });
    });

    it('canExecute returns true for transformer job type', () => {
        expect(executor.canExecute('transformer')).toBe(true);
    });

    it('canExecute returns false for other job types', () => {
        expect(executor.canExecute('api')).toBe(false);
        expect(executor.canExecute('static')).toBe(false);
    });

    it('execute calls engine with inputData and config', async () => {
        const job = { id: 1, type: 'transformer', organizationId: 1 } as any;
        const config = { rules: [{ id: 'r1', sourcePath: 'a', targetPath: 'b', type: 'direct' }] };
        const pipeline = {} as any;
        const context = { data: { input: { a: 'value' } } } as any;

        const result = await executor.execute(job, config, pipeline, context);

        expect(mockExecuteTransformations).toHaveBeenCalledWith(
            { a: 'value' },
            config,
            { inputData: { a: 'value' }, previousStepOutput: { a: 'value' } }
        );
        expect(result.success).toBe(true);
        expect(result.output).toContain('"transformed": true');
        expect(result.status).toBe('success');
    });

    it('execute passes inputData as both inputData and previousStepOutput to engine', async () => {
        mockExecuteTransformations.mockResolvedValue({ x: 1 });
        const job = { id: 1, type: 'transformer' } as any;
        const config = { rules: [] };
        const pipeline = {} as any;
        const input = { foo: 'bar' };
        const context = { data: { input } } as any;

        await executor.execute(job, config, pipeline, context);

        expect(mockExecuteTransformations).toHaveBeenCalledWith(
            input,
            config,
            { inputData: input, previousStepOutput: input }
        );
    });

    it('execute returns JSON-stringified output', async () => {
        mockExecuteTransformations.mockResolvedValue({ items: [1, 2, 3] });
        const job = { id: 1, type: 'transformer' } as any;
        const config = { rules: [] };
        const pipeline = {} as any;
        const context = { data: { input: {} } } as any;

        const result = await executor.execute(job, config, pipeline, context);

        expect(result.output).toBe(JSON.stringify({ items: [1, 2, 3] }, null, 2));
    });

    it('execute propagates engine errors', async () => {
        mockExecuteTransformations.mockRejectedValue(new Error('Transformation failed'));
        const job = { id: 1, type: 'transformer' } as any;
        const config = { rules: [] };
        const pipeline = {} as any;
        const context = { data: { input: {} } } as any;

        await expect(executor.execute(job, config, pipeline, context)).rejects.toThrow('Transformation failed');
    });
});
