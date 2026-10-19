/**
 * Pipeline Tools (PIPELINE_TOOLS) tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPipelineList = vi.fn();
const mockMapIntent = vi.fn();

vi.mock('@server/domain/pipeline/core/pipeline.service', () => ({
    pipelineService: { 
        list: (...args: unknown[]) => mockPipelineList(...args),
        getExecutionDetails: vi.fn()
    },
}));

vi.mock("@domain/pipeline/core/intent-pipeline-mapper.service.js", () => ({
    mapIntentToPipeline: (...args: unknown[]) => mockMapIntent(...args),
}));

vi.mock('@server/database_service.js', () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            returning: vi.fn().mockResolvedValue([]),
        })),
        query: {
            agentDeployments: {
                findFirst: vi.fn().mockResolvedValue(null),
            },
        },
    },
}));

vi.mock('@server/domain/agents/agent-nonce.service', () => ({
    agentNonceService: {
        generate: vi.fn((_s: string, pipelineId: number, _name: string) => `nonce-${pipelineId}`),
        validate: vi.fn().mockReturnValue({ valid: true, pipelineId: 1 }),
    },
}));

import { PIPELINE_TOOLS } from '@server/domain/tools/v1/capabilities/pipelines';

describe('PIPELINE_TOOLS', () => {
    const context = { userId: 'u1', organizationId: 1, isAdmin: true };

    beforeEach(() => {
        vi.clearAllMocks();
        mockPipelineList.mockResolvedValue([{ id: 1, name: 'JIRA Sync', description: 'Syncs JIRA', isActive: true }]);
        mockMapIntent.mockResolvedValue(null);
    });

    describe('resolve_intent_to_pipeline', () => {
        it('returns error when org context missing', async () => {
            const tool = PIPELINE_TOOLS.resolve_intent_to_pipeline;
            const result = await tool.execute!({ intent: 'Run JIRA' }, {});
            expect(result).toContain('Organization context required');
        });

        it('returns pipelineId when intent matches', async () => {
            mockMapIntent.mockResolvedValue({ pipelineId: 10, confidence: 0.9, inputHints: {} });
            const tool = PIPELINE_TOOLS.resolve_intent_to_pipeline;
            const result = await tool.execute!({ intent: 'Run JIRA analysis' }, context);
            const parsed = JSON.parse(result as string);
            expect(parsed.pipelineId).toBe(10);
            expect(parsed.confidence).toBe(0.9);
        });

        it('returns message when no pipeline found', async () => {
            mockMapIntent.mockResolvedValue(null);
            const tool = PIPELINE_TOOLS.resolve_intent_to_pipeline;
            const result = await tool.execute!({ intent: 'Do something vague' }, context);
            expect(result).toContain('No pipeline found');
        });
    });

    describe('list_pipelines', () => {
        it('returns pipelines as JSON', async () => {
            const tool = PIPELINE_TOOLS.list_pipelines;
            const result = await tool.execute!({}, context);
            const parsed = JSON.parse(result as string);
            expect(parsed).toHaveLength(1);
            expect(parsed[0]).toMatchObject({ id: 1, name: 'JIRA Sync' });
        });

        it('filters by search term', async () => {
            mockPipelineList.mockResolvedValue([
                { id: 1, name: 'JIRA Sync', description: '', isActive: true },
                { id: 2, name: 'Slack Post', description: '', isActive: true },
            ]);
            const tool = PIPELINE_TOOLS.list_pipelines;
            const result = await tool.execute!({ search: 'jira' }, context);
            const parsed = JSON.parse(result as string);
            expect(parsed).toHaveLength(1);
            expect(parsed[0].name).toContain('JIRA');
        });
    });

    describe('show_pipeline_input_form', () => {
        it('returns input_request with nonce when fields provided', async () => {
            const tool = PIPELINE_TOOLS.show_pipeline_input_form;
            const result = await tool.execute!(
                {
                    pipelineId: 1,
                    pipelineName: 'Test Pipeline',
                    fields: [{ name: 'vin', label: 'VIN', type: 'text', required: true }],
                },
                context
            );
            const parsed = JSON.parse(result as string);
            expect(parsed).toMatchObject({
                type: 'input_request',
                pipelineName: 'Test Pipeline',
                fields: expect.any(Array),
            });
            expect(parsed.nonce).toBeDefined();
        });

        it('tells the agent to converse instead of rendering an empty form', async () => {
            // The assertion used to be `toContain('No input fields provided')`, matching a
            // message this tool no longer returns. Because the suite never ran — a stray
            // apostrophe in a vi.mock specifier stopped it transforming — the drift was
            // never caught. The current message is the deliberate behaviour: a pipeline
            // with no declared fields is a conversational flow, and the agent is told not
            // to render a form rather than shown a bare error.
            const tool = PIPELINE_TOOLS.show_pipeline_input_form;
            const result = await tool.execute!(
                { pipelineId: 1, pipelineName: 'Test', fields: undefined },
                context
            );
            expect(result).toContain('No input form is needed');
            expect(result).toContain('Do NOT render a form');
        });
    });
});
