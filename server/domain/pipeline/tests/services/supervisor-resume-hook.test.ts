/**
 * SupervisorResumeHook tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupervisorResumeHook } from '../../hooks/supervisor-resume-hook.js';

const mockDbSelect = vi.hoisted(() => vi.fn());
const mockLock = vi.fn();
const mockUnlock = vi.fn();
const mockIsProcessing = vi.fn();

vi.mock('@server/database_service.js', () => ({
    db: {
        select: (...args: unknown[]) => mockDbSelect(...args),
    },
}));

vi.mock("@domain/core/infrastructure/supervisor-service.service.js", () => ({
    supervisorService: {
        executePlan: vi.fn().mockResolvedValue({ state: 'waiting', plan: {} }),
    },
}));

vi.mock('../../core/execution-manager.js', () => ({
    executionManager: {
        updateStepExecution: vi.fn().mockResolvedValue(undefined),
        updateExecution: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('@server/core/pipeline-executor.js', () => ({
    pipelineExecutor: {
        resumePipelineExecution: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock("@domain/core/async-poller.service.js", () => ({
    asyncPollerUtils: {
        isProcessing: (...args: unknown[]) => mockIsProcessing(...args),
        lock: (...args: unknown[]) => mockLock(...args),
        unlock: (...args: unknown[]) => mockUnlock(...args),
    },
}));

vi.mock('../../../server/utils/logger.js', () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    })),
}));

describe('SupervisorResumeHook', () => {
    const hook = new SupervisorResumeHook();

    beforeEach(() => {
        vi.clearAllMocks();
        mockIsProcessing.mockResolvedValue(false);
        mockDbSelect.mockReturnValue({
            from: vi.fn(() => ({
                innerJoin: vi.fn(() => ({
                    where: vi.fn(() => Promise.resolve([])),
                })),
            })),
        });
    });

    describe('onPipelineComplete', () => {
        it('returns early when pipelineExecution has no parentExecutionId', async () => {
            await hook.onPipelineComplete({
                pipelineExecution: { id: 1, status: 'completed' },
                pipeline: {},
                stepResults: [],
                orgId: 1,
            });

            expect(mockDbSelect).not.toHaveBeenCalled();
        });

        it('queries for waiting supervisor steps when parentExecutionId present', async () => {
            await hook.onPipelineComplete({
                pipelineExecution: { id: 10, parentExecutionId: 5, status: 'completed' },
                pipeline: {},
                stepResults: [],
                orgId: 1,
            });

            expect(mockDbSelect).toHaveBeenCalled();
        });
    });
});
