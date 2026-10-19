
process.env.DISABLE_JOB_QUEUE = 'true';

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Hoist all mocks to ensure they are available during module initialization
vi.mock('@server/integrations/state-tracker-redis.js', () => ({
    stateTracker: {
        incrementVisit: vi.fn().mockResolvedValue(1),
        setPayloadHash: vi.fn().mockResolvedValue(true),
    }
}));

const mockMission = { id: 105, budgetLimitUsd: "5.00", objective: null };

vi.mock('@server/database_service.js', () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn(res => Promise.resolve([mockMission]).then(r => r)),
            returning: vi.fn().mockResolvedValue([mockMission]),
            then: vi.fn(res => Promise.resolve([mockMission]).then(res))
        })),
        insert: vi.fn(() => ({
            values: vi.fn().mockReturnThis(),
            returning: vi.fn().mockResolvedValue([]),
            then: vi.fn(res => Promise.resolve([]).then(res))
        })),
        update: vi.fn(() => ({
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            returning: vi.fn().mockResolvedValue([]),
            then: vi.fn(res => Promise.resolve([]).then(res))
        })),
        execute: vi.fn().mockResolvedValue({ rows: [{ avg_seconds: "1" }] }),
        transaction: vi.fn((fn) => fn({
            select: vi.fn().mockReturnThis(),
            insert: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            delete: vi.fn().mockReturnThis(),
            transaction: vi.fn((innerFn) => innerFn({})),
        })),
    }
}));

vi.mock('@domain/pipeline/core/pipeline.service.js', () => ({
    pipelineService: {
        createExecution: vi.fn().mockResolvedValue({ id: 1, missionId: 105 }),
        getSystem: vi.fn().mockResolvedValue({ id: 10, organizationId: 1 }),
        listSteps: vi.fn().mockResolvedValue([{ id: 1, order: 1, jobId: 5 }]),
        createStepExecution: vi.fn().mockResolvedValue({ id: 100 }),
        updateStepExecution: vi.fn().mockResolvedValue({}),
        updateExecution: vi.fn().mockResolvedValue({}),
    }
}));

vi.mock('@domain/jobs/job.service.js', () => ({
    jobService: {
        getByIds: vi.fn().mockResolvedValue([{ id: 5, name: 'Test Job' }]),
        getJob: vi.fn().mockResolvedValue({ id: 5, type: 'static', config: {} }),
        getById: vi.fn().mockResolvedValue({ id: 5, type: 'static', config: {} }),
    }
}));

vi.mock('@domain/mission/core/mission-run.service.js', () => ({
    missionRunService: {
        update: vi.fn().mockResolvedValue({}),
        list: vi.fn().mockResolvedValue([]),
        checkpoint: vi.fn().mockResolvedValue({}),
        getById: vi.fn().mockResolvedValue({ id: 200, isShadow: false }),
    },
}));

vi.mock('@server/core/pipeline-step-runner.js', () => ({
    executePipelineStep: vi.fn().mockResolvedValue({ success: true, status: 'completed', output: 'ok' }),
    // Phase 2: the fallback-job branch runs through resolveAndExecuteJob.
    resolveAndExecuteJob: vi.fn().mockResolvedValue({ success: true, status: 'success', output: 'fallback-ok' }),
}));

// Phase 2: the genuine-failure path wraps the step in errorRecoveryService.attemptRecovery
// before reaching the onFailureAction branch — stub it to a no-recovery result so the
// fallback logic (not the recovery retry) is what the tests exercise.
vi.mock('@domain/jobs/core/error-recovery.service.js', () => ({
    errorRecoveryService: {
        attemptRecovery: vi.fn().mockResolvedValue({ recovered: false }),
        escalateToHIL: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('@server/core/loopbane-protocols.js', () => ({
    checkCycleBreaker: vi.fn().mockResolvedValue({ action: 'continue' }),
    checkStagnationLock: vi.fn().mockResolvedValue({ action: 'continue' }),
    checkDoomsdayClock: vi.fn().mockReturnValue({ allowed: true }),
    calculatePayloadHash: vi.fn().mockReturnValue('hash'),
}));

vi.mock('@server/core/infrastructure-protocol.js', () => ({
    infrastructureProtocol: {
        performPreFlightCheck: vi.fn().mockResolvedValue({ healthy: true, issues: [] }),
        verifySchemaHealth: vi.fn().mockResolvedValue({ healthy: true, issues: [] }),
    }
}));

vi.mock('@domain/pipeline/hooks/index.js', () => ({
    initializeHooks: vi.fn(),
}));

vi.mock('@domain/pipeline/hooks/execution-hooks.js', () => ({
    hookRegistry: {
        triggerStepComplete: vi.fn().mockResolvedValue(undefined),
        triggerPipelineComplete: vi.fn().mockResolvedValue(undefined),
        register: vi.fn(),
    }
}));

vi.mock('@domain/pipeline/core/workflow-lifecycle.service.js', () => ({
    workflowLifecycleService: {
        getReleaseManifest: vi.fn(),
        resolveActiveRelease: vi.fn().mockResolvedValue(null),
        findByPipeline: vi.fn().mockResolvedValue(null),
    },
}));

vi.mock('@domain/mission/core/mission.service.js', () => {
    return {
        missionService: {
            checkBudget: vi.fn().mockImplementation(async () => {
                if (process.env.MOCK_BUDGET_EXCEEDED === "true") {
                    throw new Error("Mission budget exceeded: 5.25 > 5.00");
                }
            }),
            getMissionDetail: vi.fn().mockResolvedValue({ id: 105, budgetLimitUsd: "500.00" }),
            calculateTotalSpend: vi.fn().mockResolvedValue(0),
        }
    };
});

vi.mock('@domain/mission/core/mission-query.service.js', () => ({
    missionQueryService: {
        calculateTotalSpend: vi.fn().mockImplementation(async () => {
            return process.env.MOCK_BUDGET_EXCEEDED === 'true' ? 10.00 : 1.00;
        }),
    },
}));

// Import the module after mocks are defined
import { PipelineExecutor } from '@server/core/pipeline-executor.js';
import { executePipelineStep, resolveAndExecuteJob } from '@server/core/pipeline-step-runner.js';
import { pipelineService } from '@domain/pipeline/core/pipeline.service.js';
import { jobService } from '@domain/jobs/job.service.js';
import { workflowLifecycleService } from '@domain/pipeline/core/workflow-lifecycle.service.js';
import { hookRegistry } from '@domain/pipeline/hooks/execution-hooks.js';
import { db } from '@server/database_service.js';

describe('PipelineExecutor - Budget Enforcement', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should halt execution if mission budget is exceeded', async () => {
        process.env.MOCK_BUDGET_EXCEEDED = "true";

        const executor = new PipelineExecutor();
        const result = await executor.executePipeline(
            10, 'user-1', null, null, {}, undefined, undefined, 105, 200
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Mission budget exceeded');
    });

    it('should allow execution if budget check passes', async () => {
        process.env.MOCK_BUDGET_EXCEEDED = "false";

        const executor = new PipelineExecutor();
        const result = await executor.executePipeline(
            10, 'user-1', null, null, {}, undefined, undefined, 105, 200
        );

        expect(result.success).toBe(true);
    });
});

describe('PipelineExecutor - runOnCondition gating (previous-executed-step semantics)', () => {
    // on_success: run only when the previous step did NOT fail
    it('runs on_success steps after a success', () => {
        expect(PipelineExecutor.shouldRunByCondition('on_success', false)).toBe(true);
    });
    it('skips on_success steps after a failure', () => {
        expect(PipelineExecutor.shouldRunByCondition('on_success', true)).toBe(false);
    });

    // on_failure: run only when the previous step failed (recovery/cleanup steps)
    it('runs on_failure steps after a failure', () => {
        expect(PipelineExecutor.shouldRunByCondition('on_failure', true)).toBe(true);
    });
    it('skips on_failure steps after a success', () => {
        expect(PipelineExecutor.shouldRunByCondition('on_failure', false)).toBe(false);
    });

    // always: run regardless of outcome
    it('runs always steps after success', () => {
        expect(PipelineExecutor.shouldRunByCondition('always', false)).toBe(true);
    });
    it('runs always steps after failure', () => {
        expect(PipelineExecutor.shouldRunByCondition('always', true)).toBe(true);
    });

    // default/blank/null behaves like on_success (preserves legacy default-run-on-success)
    it('treats null/blank as on_success', () => {
        expect(PipelineExecutor.shouldRunByCondition(null, false)).toBe(true);
        expect(PipelineExecutor.shouldRunByCondition(undefined, true)).toBe(false);
        expect(PipelineExecutor.shouldRunByCondition('   ', true)).toBe(false);
    });
});

describe('PipelineExecutor - onFailureAction = "Execute Fallback Job" (Phase 2)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.MOCK_BUDGET_EXCEEDED = 'false';
    });

    it('runs the fallback job when the step fails, persists a linked execution row, and completes with a failure summary', async () => {
        // Single step that fails and is configured to execute a fallback job.
        vi.mocked(pipelineService.listSteps).mockResolvedValueOnce([
            { id: 1, order: 1, jobId: 5, onFailureAction: 'Execute Fallback Job', fallbackJobId: 7 },
        ] as any);
        // The original step fails; recovery wrapper returns the same failure (mocked no-op).
        vi.mocked(executePipelineStep).mockResolvedValueOnce({ success: false, status: 'failure', output: '', error: 'boom' } as any);
        // The fallback job succeeds → failure is recovered.
        vi.mocked(resolveAndExecuteJob).mockResolvedValueOnce({ success: true, status: 'success', output: 'recovered' } as any);

        // createStepExecution is called twice: once for the failed step, once for the fallback.
        vi.mocked(pipelineService.createStepExecution)
            .mockResolvedValueOnce({ id: 100 } as any)   // failed step's execution row
            .mockResolvedValueOnce({ id: 101 } as any);  // fallback execution row

        const executor = new PipelineExecutor();
        const result = await executor.executePipeline(10, 'user-1', null, null, {}, undefined, undefined, 105, 200);

        // Recovered run still "succeeds" overall (no hard failure), but is flagged with the summary.
        expect(result.success).toBe(true);
        // The fallback job actually ran.
        expect(resolveAndExecuteJob).toHaveBeenCalledTimes(1);
        // A dedicated fallback step-execution row was created, linked to the failed step (id 100).
        const fallbackCreate = vi.mocked(pipelineService.createStepExecution).mock.calls
            .map(c => c[0] as any)
            .find(arg => arg.parentStepExecutionId === 100);
        expect(fallbackCreate).toBeDefined();
        expect(fallbackCreate.jobId).toBe(7);
        // The run was completed with the "completed with failures" summary, not a clean success.
        const completedCall = vi.mocked(pipelineService.updateExecution).mock.calls
            .map(c => c[1] as any)
            .find(arg => arg?.status === 'completed');
        expect(completedCall).toBeDefined();
        expect(completedCall.error).toContain('Completed with one or more failed steps');
    });

    it('fails the pipeline when the fallback job also fails', async () => {
        vi.mocked(pipelineService.listSteps).mockResolvedValueOnce([
            { id: 1, order: 1, jobId: 5, onFailureAction: 'Execute Fallback Job', fallbackJobId: 7 },
        ] as any);
        vi.mocked(executePipelineStep).mockResolvedValueOnce({ success: false, status: 'failure', output: '', error: 'boom' } as any);
        // Fallback ALSO fails → unrecovered → pipeline fails.
        vi.mocked(resolveAndExecuteJob).mockResolvedValueOnce({ success: false, status: 'failure', output: '', error: 'fallback boom' } as any);

        const executor = new PipelineExecutor();
        const result = await executor.executePipeline(10, 'user-1', null, null, {}, undefined, undefined, 105, 200);

        expect(resolveAndExecuteJob).toHaveBeenCalledTimes(1);
        expect(result.success).toBe(false);
    });

    it('behaves like "Stop Pipeline" when Execute Fallback Job is set but no fallbackJobId is configured', async () => {
        vi.mocked(pipelineService.listSteps).mockResolvedValueOnce([
            { id: 1, order: 1, jobId: 5, onFailureAction: 'Execute Fallback Job', fallbackJobId: null },
        ] as any);
        vi.mocked(executePipelineStep).mockResolvedValueOnce({ success: false, status: 'failure', output: '', error: 'boom' } as any);

        const executor = new PipelineExecutor();
        const result = await executor.executePipeline(10, 'user-1', null, null, {}, undefined, undefined, 105, 200);

        // No fallback target → fail-safe stop; the fallback job is never invoked.
        expect(resolveAndExecuteJob).not.toHaveBeenCalled();
        expect(result.success).toBe(false);
    });
});

/**
 * MissionCheckpointHook.onPipelineComplete is what closes a mission run, so every
 * exit that finishes an execution must fire the pipeline-complete hooks. Two did not:
 * the resume branch where every step is already done (the path a human approving a
 * final HIL step takes) and the loop's catch. Their runs stayed "active", the
 * stale-run healer relaunched them, and the same step came back for approval.
 */
describe('PipelineExecutor - every finishing exit fires the pipeline-complete hooks', () => {
    const completeCalls = () => vi.mocked(hookRegistry.triggerPipelineComplete).mock.calls.map(c => c[0] as any);

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.MOCK_BUDGET_EXCEEDED = 'false';
    });

    it('resuming an execution whose steps are all done completes it AND fires the hooks', async () => {
        (pipelineService as any).getExecutionSystem = vi.fn().mockResolvedValue({
            id: 42, pipelineId: 10, status: 'waiting_external_input', missionId: 105, missionRunId: 200, createdBy: 'user-1',
        });
        // The step-execution lookup: the pipeline's only step already succeeded.
        vi.mocked(db.select).mockImplementationOnce((() => {
            const rows = [{ pipelineStepId: 1, stepOrder: 1, status: 'success', output: 'approved', jobId: 5 }];
            const q: any = { from: () => q, where: () => q, orderBy: () => q, then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej) };
            return q;
        }) as any);

        const executor = new PipelineExecutor();
        const result = await executor.resumePipelineExecution(42, null, { approved: true });

        expect(result.success).toBe(true);
        expect(pipelineService.updateExecution).toHaveBeenCalledWith(42, expect.objectContaining({ status: 'completed' }));
        expect(completeCalls()).toHaveLength(1);
        expect(completeCalls()[0].pipelineExecution).toEqual(expect.objectContaining({ id: 42, status: 'completed', missionId: 105 }));
    });

    it('an error inside the loop marks the execution failed AND fires the hooks with that status', async () => {
        // Throw from the success-path completion write, which is inside the loop's try.
        vi.mocked(pipelineService.updateExecution).mockImplementation(async (_id: any, update: any) => {
            if (update?.status === 'completed') throw new Error('db went away');
            return {} as any;
        });

        const executor = new PipelineExecutor();
        const result = await executor.executePipeline(10, 'user-1', null, null, {}, undefined, undefined, 105, 200);

        expect(result.success).toBe(false);
        expect(pipelineService.updateExecution).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'failed' }));
        expect(completeCalls()).toHaveLength(1);
        expect(completeCalls()[0].pipelineExecution.status).toBe('failed');

        vi.mocked(pipelineService.updateExecution).mockReset();
        vi.mocked(pipelineService.updateExecution).mockResolvedValue({} as any);
    });

    it('a normal finish fires the hooks exactly once', async () => {
        const executor = new PipelineExecutor();
        const result = await executor.executePipeline(10, 'user-1', null, null, {}, undefined, undefined, 105, 200);

        expect(result.success).toBe(true);
        expect(completeCalls()).toHaveLength(1);
        expect(completeCalls()[0].pipelineExecution.status).toBe('completed');
    });

    it('a failing hook does not turn a finished resume into an error', async () => {
        vi.mocked(hookRegistry.triggerPipelineComplete).mockRejectedValueOnce(new Error('hook blew up'));
        (pipelineService as any).getExecutionSystem = vi.fn().mockResolvedValue({ id: 43, pipelineId: 10, status: 'running', createdBy: 'user-1' });
        vi.mocked(db.select).mockImplementationOnce((() => {
            const rows = [{ pipelineStepId: 1, stepOrder: 1, status: 'success', output: 'ok', jobId: 5 }];
            const q: any = { from: () => q, where: () => q, orderBy: () => q, then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej) };
            return q;
        }) as any);

        const result = await new PipelineExecutor().resumePipelineExecution(43);
        expect(result.success).toBe(true);
    });
});

/**
 * Release-pinned execution: a run started under a workflow release executes the
 * manifest snapshotted at publish time — not the live pipeline_steps/jobs rows.
 * Runs without a release keep the legacy path.
 */
describe('PipelineExecutor - release-pinned execution', () => {
    const manifest = {
        manifestVersion: 1,
        pipeline: {
            id: 10, name: 'P', description: null, triggerType: 'manual',
            triggerCredentialId: null, labels: null, organizationId: 1,
            governorSettings: { enabled: true, mode: 'AUTONOMOUS' },
            governorPolicyId: 9,
            enableKnowledgeGraph: false, knowledgeGraphConfig: null,
            monthlyBudgetUsd: '7.00',
        },
        steps: [{ id: 77, pipelineId: 10, jobId: 5, order: 1 }],
        jobs: { '5': { id: 5, name: 'Released Job' } },
        triggers: [],
        dependencies: [],
        formReleases: { '12': { releaseNumber: 2, formRevision: 9, name: 'Intake v2' } },
        createdAt: '2026-01-01T00:00:00.000Z',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.MOCK_BUDGET_EXCEEDED = 'false';
        vi.mocked(workflowLifecycleService.getReleaseManifest).mockResolvedValue({
            workflowId: 42,
            manifest: manifest as any,
        });
    });

    it('executes the manifest steps and never touches the live step/job tables', async () => {
        const executor = new PipelineExecutor();
        const result = await executor.executePipeline(
            10, 'user-1', null, null, {}, undefined, undefined, undefined, undefined,
            { workflowReleaseId: 71, workflowDeploymentId: 88 },
        );

        expect(result.success).toBe(true);
        expect(pipelineService.listSteps).not.toHaveBeenCalled();
        expect(jobService.getByIds).not.toHaveBeenCalled();
        // The loop ran the MANIFEST step (id 77), not the live row (id 1).
        expect(vi.mocked(executePipelineStep).mock.calls[0][0]).toMatchObject({ id: 77, jobId: 5 });
        // The execution row is stamped with the release/deployment it ran under.
        expect(pipelineService.createExecution).toHaveBeenCalledWith(
            expect.objectContaining({ workflowReleaseId: 71, workflowDeploymentId: 88 }),
        );
        // Release governance overlay applied to the pipeline handed downstream.
        const hookArg = vi.mocked(hookRegistry.triggerPipelineComplete).mock.calls[0]?.[0] as any;
        expect(hookArg?.pipeline?.governorPolicyId).toBe(9);
        // The manifest's pinned form releases ride on the step context.
        const ctx = vi.mocked(executePipelineStep).mock.calls[0][2] as any;
        expect(ctx.workflowRelease).toEqual({
            id: 71,
            formReleases: { '12': { releaseNumber: 2, formRevision: 9, name: 'Intake v2' } },
        });
    });

    it('refuses a manifest pinned to a different pipeline', async () => {
        vi.mocked(workflowLifecycleService.getReleaseManifest).mockResolvedValue({
            workflowId: 42,
            manifest: { ...manifest, pipeline: { ...manifest.pipeline, id: 999 } } as any,
        });
        const result = await new PipelineExecutor().executePipeline(
            10, 'user-1', null, null, {}, undefined, undefined, undefined, undefined,
            { workflowReleaseId: 71 },
        );
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/release/i);
        expect(executePipelineStep).not.toHaveBeenCalled();
    });

    it('a release-pinned run resumes from the manifest, not the live draft', async () => {
        (pipelineService as any).getExecutionSystem = vi.fn().mockResolvedValue({
            id: 50, pipelineId: 10, status: 'running', createdBy: 'user-1', workflowReleaseId: 71,
        });
        // completedStepExecutions lookup → nothing done yet.
        vi.mocked(db.select).mockImplementationOnce((() => {
            const q: any = { from: () => q, where: () => q, orderBy: () => q, then: (res: any, rej: any) => Promise.resolve([]).then(res, rej) };
            return q;
        }) as any);

        const result = await new PipelineExecutor().resumePipelineExecution(50);
        expect(result.success).toBe(true);
        expect(pipelineService.listSteps).not.toHaveBeenCalled();
        expect(vi.mocked(executePipelineStep).mock.calls[0][0]).toMatchObject({ id: 77 });
    });

    it('a run with no release still reads live steps (regression guard)', async () => {
        const result = await new PipelineExecutor().executePipeline(
            10, 'user-1', null, null, {}, undefined, undefined, 105, 200,
        );
        expect(result.success).toBe(true);
        expect(pipelineService.listSteps).toHaveBeenCalledWith(10);
        expect(workflowLifecycleService.getReleaseManifest).not.toHaveBeenCalled();
    });
});
