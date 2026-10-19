/**
 * FormAgentExecutor tests
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { FormAgentExecutor } from "@domain/jobs/core/executors/form-agent-executor.js";

describe('FormAgentExecutor', () => {
    const executor = new FormAgentExecutor();

    describe('canExecute', () => {
        it('returns true for form_agent job type', () => {
            expect(executor.canExecute('form_agent')).toBe(true);
        });

        it('returns false for other job types', () => {
            expect(executor.canExecute('shell')).toBe(false);
            expect(executor.canExecute('ai_agent')).toBe(false);
            expect(executor.canExecute('human_approval')).toBe(false);
        });
    });

    describe('execute', () => {
        const baseJob = { id: 1, organizationId: 1, type: 'form_agent' } as any;
        const basePipeline = {} as any;
        const baseContext = { named: {}, positional: {} };

        it('returns waiting_external_input when stepExecutionId present', async () => {
            const config = {
                documentTemplateId: 1,
                formSchema: { fields: [{ key: 'name', type: 'string', label: 'Name', required: true }] },
                variableMappings: {},
                timeoutMinutes: 30,
                retryOnFailure: false,
            };

            const result = await executor.execute(
                baseJob,
                config,
                basePipeline,
                baseContext,
                undefined,
                42
            );

            expect(result.status).toBe('waiting_external_input');
            expect(result.success).toBe(true);
            const output = JSON.parse(result.output!);
            expect(output._type).toBe('form_agent_context');
            expect(output.stepExecutionId).toBe(42);
            expect(output.formSchema).toEqual(config.formSchema);
        });

        it('returns mock output for dry run when stepExecutionId is 0', async () => {
            const config = {
                documentTemplateId: 1,
                formSchema: {
                    fields: [
                        { key: 'name', type: 'string', label: 'Name' },
                        { key: 'count', type: 'number', label: 'Count' },
                        { key: 'active', type: 'boolean', label: 'Active' },
                    ],
                },
                variableMappings: {},
                timeoutMinutes: 30,
                retryOnFailure: false,
            };

            const result = await executor.execute(
                baseJob,
                config,
                basePipeline,
                baseContext,
                undefined,
                0
            );

            expect(result.status).toBe('success');
            expect(result.success).toBe(true);
            const output = JSON.parse(result.output!);
            expect(output.name).toBe('Sample Value');
            expect(output.count).toBe(123);
            expect(output.active).toBe(true);
        });

        it('returns mock output for dry run when stepExecutionId missing', async () => {
            const config = {
                documentTemplateId: 1,
                formSchema: {
                    fields: [
                        { key: 'choice', type: 'select', label: 'Choice', options: ['A', 'B', 'C'] },
                        { key: 'custom', type: 'string', label: 'Custom', defaultValue: 'custom-val' },
                    ],
                },
                variableMappings: {},
                timeoutMinutes: 30,
                retryOnFailure: false,
            };

            const result = await executor.execute(baseJob, config, basePipeline, baseContext);

            expect(result.status).toBe('success');
            const output = JSON.parse(result.output!);
            expect(output.choice).toBe('A');
            expect(output.custom).toBe('custom-val');
        });

        it('handles date type in form schema', async () => {
            const config = {
                documentTemplateId: 1,
                formSchema: {
                    fields: [{ key: 'dob', type: 'date', label: 'Date of Birth' }],
                },
                variableMappings: {},
                timeoutMinutes: 30,
                retryOnFailure: false,
            };

            const result = await executor.execute(baseJob, config, basePipeline, baseContext);

            const output = JSON.parse(result.output!);
            expect(output.dob).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });

        it('handles empty formSchema fields', async () => {
            const config = {
                documentTemplateId: 1,
                formSchema: { fields: [] },
                variableMappings: {},
                timeoutMinutes: 30,
                retryOnFailure: false,
            };

            const result = await executor.execute(baseJob, config, basePipeline, baseContext);

            expect(result.status).toBe('success');
            expect(JSON.parse(result.output!)).toEqual({});
        });
    });
});
