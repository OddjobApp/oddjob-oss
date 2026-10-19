/**
 * Static Executor tests
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { StaticExecutor } from "@domain/jobs/core/executors/static-executor.js";
import type { Job, Pipeline } from "@shared/schema/index.js";

const executor = new StaticExecutor();

const mockJob: Job = {
    id: 1,
    name: 'Test Job',
    type: 'static_response',
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

describe('StaticExecutor', () => {
    it('canExecute returns true for static_response', () => {
        expect(executor.canExecute('static_response')).toBe(true);
    });

    it('canExecute returns false for other types', () => {
        expect(executor.canExecute('curl')).toBe(false);
        expect(executor.canExecute('api')).toBe(false);
    });

    it('returns content as output when no requiredVariables', async () => {
        const config = { content: 'Hello, world!' };
        const result = await executor.execute(mockJob, config, mockPipeline, baseContext);

        expect(result.success).toBe(true);
        expect(result.output).toBe('Hello, world!');
        expect(result.status).toBe('success');
    });

    it('returns empty string when content is empty', async () => {
        const config = { content: '' };
        const result = await executor.execute(mockJob, config, mockPipeline, baseContext);

        expect(result.success).toBe(true);
        expect(result.output).toBe('');
    });

    it('fails when requiredVariables are missing', async () => {
        const config = {
            content: 'Hi',
            requiredVariables: ['userId'],
        };
        const result = await executor.execute(mockJob, config, mockPipeline, baseContext);

        expect(result.success).toBe(false);
        expect(result.output).toContain('Missing required input variables');
        expect(result.output).toContain('userId');
        expect(result.status).toBe('failed');
    });

    it('succeeds when requiredVariables are in context.data', async () => {
        const config = {
            content: 'Welcome',
            requiredVariables: ['userId'],
        };
        const context = {
            ...baseContext,
            data: { userId: '123' },
        };
        const result = await executor.execute(mockJob, config, mockPipeline, context);

        expect(result.success).toBe(true);
        expect(result.output).toBe('Welcome');
    });

    it('succeeds when requiredVariables are in context.named', async () => {
        const config = {
            content: 'Hi',
            requiredVariables: ['name'],
        };
        const context = {
            ...baseContext,
            named: { name: 'Alice' },
        };
        const result = await executor.execute(mockJob, config, mockPipeline, context);

        expect(result.success).toBe(true);
        expect(result.output).toBe('Hi');
    });

    it('succeeds when requiredVariables are nested in context.data', async () => {
        const config = {
            content: 'OK',
            requiredVariables: ['ticket.id'],
        };
        const context = {
            ...baseContext,
            data: { ticket: { id: 'T-1' } },
        };
        const result = await executor.execute(mockJob, config, mockPipeline, context);

        expect(result.success).toBe(true);
        expect(result.output).toBe('OK');
    });

    it('builds outputMapping JSON when outputMapping provided', async () => {
        const config = {
            content: 'Done',
            outputMapping: {
                status: 'success',
                count: '42',
            },
        };
        const result = await executor.execute(mockJob, config, mockPipeline, baseContext);

        expect(result.success).toBe(true);
        const parsed = JSON.parse(result.output as string);
        expect(parsed.status).toBe('success');
        expect(parsed.count).toBe('42');
        expect(parsed.message).toBe('Done');
    });
});
