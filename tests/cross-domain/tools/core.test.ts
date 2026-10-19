/**
 * Tools Core (CORE_TOOLS) tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CORE_TOOLS } from '../../../server/domain/tools/v1/capabilities/core.js';

describe('CORE_TOOLS', () => {
    const emptyContext = { userId: 'u1', organizationId: 1, isAdmin: false };

    describe('sleep', () => {
        it('returns wait status with sleepUntil', async () => {
            const tool = CORE_TOOLS.sleep;
            const result = await tool.execute!({ seconds: 2 }, emptyContext);

            expect(result).toMatchObject({
                _status: 'waiting_async',
                suspensionMetadata: expect.objectContaining({ reason: expect.any(String) }),
            });
            expect((result as any).sleepUntil).toBeInstanceOf(Date);
        });
    });

    describe('calculator', () => {
        it('evaluates simple expression', async () => {
            const tool = CORE_TOOLS.calculator;
            const result = await tool.execute!({ expression: '2 + 2' }, emptyContext);
            expect(result).toBe('4');
        });

        it('rejects invalid characters', async () => {
            const tool = CORE_TOOLS.calculator;
            const result = await tool.execute!({ expression: '2 + 2; exec("rm -rf")' }, emptyContext);
            expect(result).toContain('Error');
        });
    });

    describe('current_time', () => {
        it('returns ISO date string', async () => {
            const tool = CORE_TOOLS.current_time;
            const result = await tool.execute!({}, emptyContext);
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        });
    });

    describe('get_job_schema', () => {
        it('returns schema for known job type', async () => {
            const tool = CORE_TOOLS.get_job_schema;
            const result = await tool.execute!({ jobType: 'folder_import' }, emptyContext);
            expect(result).toBeDefined();
            expect(typeof result).toBe('string');
        });

        it('returns error for unknown job type', async () => {
            const tool = CORE_TOOLS.get_job_schema;
            const result = await tool.execute!({ jobType: 'unknown_type_xyz' }, emptyContext);
            expect(result).toContain('Unknown job type');
        });
    });

    describe('get_pipeline_variable_syntax', () => {
        it('returns documentation string', async () => {
            const tool = CORE_TOOLS.get_pipeline_variable_syntax;
            const result = await tool.execute!({}, emptyContext);
            expect(result).toContain('{{steps.0.output}}');
            expect(result).toContain('Pipeline Variable Syntax');
        });
    });

    describe('request_execute_mode', () => {
        it('returns mode switch request JSON', async () => {
            const tool = CORE_TOOLS.request_execute_mode;
            const result = await tool.execute!({ reason: 'Need to run pipeline' }, emptyContext);
            const parsed = JSON.parse(result as string);
            expect(parsed).toMatchObject({
                type: 'mode_switch_request',
                targetMode: 'execute',
                reason: 'Need to run pipeline',
            });
        });
    });
});
