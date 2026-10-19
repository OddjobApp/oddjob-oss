import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({
    mockAIClient: {
        execute: vi.fn()
    },
    mockInsert: vi.fn(),
    mockSelect: vi.fn(),
    mockRunAgentLoop: vi.fn(),
    mockGetAiConfig: vi.fn()
}));

vi.mock('@domain/ai/core/ai-client.service.js', () => ({
    AIClientFactory: {
        getClient: vi.fn(() => mocks.mockAIClient)
    }
}));

vi.mock('@server/database_service.js', () => ({
    db: {
        insert: () => ({
            values: (...args: unknown[]) => {
                const result = mocks.mockInsert(...args);
                return result ?? { returning: vi.fn().mockResolvedValue([]) };
            }
        }),
        select: () => ({
            from: () => ({
                where: mocks.mockSelect
            })
        })
    }
}));

vi.mock('@domain/agents/agent-runner.js', () => ({
    runAgentLoop: (...args: any[]) => mocks.mockRunAgentLoop(...args)
}));

vi.mock('@server/domain/ai/core/system-ai.service.js', () => ({
    systemAiService: {
        getAiConfig: (...args: any[]) => mocks.mockGetAiConfig(...args)
    }
}));

vi.mock('@domain/mission/core/mission-run.service.js', () => ({
    missionRunService: {
        create: vi.fn().mockResolvedValue({ id: 999 }),
    }
}));

import { DELEGATION_TOOLS } from '@domain/tools/v1/capabilities/delegation.js';

describe('Agent Delegation', () => {
    const context = { 
        organizationId: 1, 
        missionId: 10, 
        userId: 'u1', 
        jobId: 100,
        allowedToolNames: ['t1', 't2']
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockGetAiConfig.mockResolvedValue({ 
            provider: 'google', 
            model: 'gemini-1.5-flash',
            apiKey: 'test-key'
        });
    });

    it('should allow an agent to delegate a task to a sub-agent', async () => {
        mocks.mockRunAgentLoop.mockResolvedValue({
            output: 'Sub-task completed successfully',
            success: true
        });

        const result = await (DELEGATION_TOOLS as any).delegate_task.execute!(
            { goal: 'Test Sub-Task', maxIterations: 5 },
            context as any
        );

        expect(result).toContain('SUB-AGENT RESULT');
        expect(result).toContain('Sub-task completed successfully');
        
        expect(mocks.mockRunAgentLoop).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ provider: 'google' }),
            'Test Sub-Task',
            ['t1', 't2'], // Inherited tools
            5,
            'test-key',
            expect.objectContaining({
                isSubAgent: true,
                parentId: 100
            }),
            undefined, // traceContext
            false,     // dryRun
            undefined, // attachments
            'full'     // supervision
        );
    });

    it('should handle sub-agent failure gracefully', async () => {
        mocks.mockRunAgentLoop.mockRejectedValue(new Error('Sub-agent crashed'));

        const result = await (DELEGATION_TOOLS as any).delegate_task.execute!(
            { goal: 'Fail Task' },
            context as any
        );

        expect(result).toContain('Error: Sub-agent execution failed');
        expect(result).toContain('Sub-agent crashed');
    });
});
