/**
 * MissionCheckpointHook tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MissionCheckpointHook } from '@domain/pipeline/hooks/mission-checkpoint-hook.js';

const mockList = vi.fn();
const mockCheckpoint = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@domain/mission/core/mission-run.service.js", () => ({
    missionRunService: {
        list: (...args: unknown[]) => mockList(...args),
        checkpoint: (...args: unknown[]) => mockCheckpoint(...args),
        update: (...args: unknown[]) => mockUpdate(...args),
    },
}));

describe('MissionCheckpointHook', () => {
    const hook = new MissionCheckpointHook();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => { });
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    describe('onPipelineComplete', () => {
        it('does nothing when pipelineExecution has no missionId', async () => {
            await hook.onPipelineComplete({
                pipelineExecution: { id: 1, status: 'completed' },
                pipeline: {},
                stepResults: [],
                orgId: 1,
            });

            expect(mockList).not.toHaveBeenCalled();
        });

        it('marks active missions as completed when pipeline succeeds', async () => {
            mockList.mockResolvedValue([
                { id: 10, missionId: 5, status: 'active' },
            ]);
            await hook.onPipelineComplete({
                pipelineExecution: { id: 100, missionId: 5, status: 'completed' },
                pipeline: {},
                stepResults: [],
                orgId: 1,
            });

            expect(mockList).toHaveBeenCalledWith({ missionId: 5, statuses: ['active', 'waiting_on_human'] });
            expect(mockUpdate).toHaveBeenCalledWith(10, {
                status: 'completed',
                pipelineExecutionId: 100,
            });
        });

        it('marks active missions as failed when pipeline fails', async () => {
            mockList.mockResolvedValue([{ id: 10, missionId: 5, status: 'active' }]);
            await hook.onPipelineComplete({
                pipelineExecution: { id: 100, missionId: 5, status: 'failed' },
                pipeline: {},
                stepResults: [],
                orgId: 1,
            });

            expect(mockUpdate).toHaveBeenCalledWith(10, {
                status: 'failed',
                pipelineExecutionId: 100,
            });
        });

        it('updates all active missions for the missionId', async () => {
            mockList.mockResolvedValue([
                { id: 10, missionId: 5, status: 'active' },
                { id: 11, missionId: 5, status: 'active' },
            ]);
            await hook.onPipelineComplete({
                pipelineExecution: { id: 100, missionId: 5, status: 'completed' },
                pipeline: {},
                stepResults: [],
                orgId: 1,
            });

            expect(mockUpdate).toHaveBeenCalledTimes(2);
            expect(mockUpdate).toHaveBeenCalledWith(10, expect.any(Object));
            expect(mockUpdate).toHaveBeenCalledWith(11, expect.any(Object));
        });
    });

    describe('onStepComplete', () => {
        it('does nothing when result is not successful', async () => {
            await hook.onStepComplete({
                result: { success: false },
                pipelineExecution: { missionId: 5 },
                pipeline: {},
                context: {},
                currentStep: { order: 0 },
                orgId: 1,
            } as any);

            expect(mockList).not.toHaveBeenCalled();
        });

        it('does nothing when pipelineExecution has no missionId', async () => {
            await hook.onStepComplete({
                result: { success: true },
                pipelineExecution: {},
                pipeline: {},
                context: {},
                currentStep: { order: 0 },
                orgId: 1,
            } as any);

            expect(mockList).not.toHaveBeenCalled();
        });

        it('calls checkpoint with merged context and step reason', async () => {
            mockList.mockResolvedValue([
                {
                    id: 10,
                    missionId: 5,
                    missionContext: { existing: 'value' },
                    pipelineExecutionId: null,
                },
            ]);
            await hook.onStepComplete({
                result: { success: true },
                pipelineExecution: { id: 100, missionId: 5 },
                pipeline: {},
                context: {
                    positional: { 0: 'step0out', 1: 'step1out' },
                    named: { summary: 'ok' },
                },
                userId: 'user-1',
                currentStep: { order: 1 },
                orgId: 1,
            } as any);

            expect(mockCheckpoint).toHaveBeenCalledWith({
                missionRunId: 10,
                missionId: 5,
                missionContext: expect.objectContaining({
                    existing: 'value',
                    step_0: 'step0out',
                    step_1: 'step1out',
                    summary: 'ok',
                }),
                reason: 'checkpoint:step_1',
                changedBy: 'user-1',
            });
        });

        it('finds the run by mission with a STATUSES filter when the execution carries no run id', async () => {
            // This passed `status: [...]`; list() compares `status` with eq(), so the array
            // matched nothing and the fallback never checkpointed. The mock above ignores
            // its arguments, which is how that went unnoticed.
            mockList.mockResolvedValue([{ id: 10, missionId: 5, missionContext: {}, pipelineExecutionId: 100 }]);
            await hook.onStepComplete({
                result: { success: true },
                pipelineExecution: { id: 100, missionId: 5 },
                pipeline: {},
                context: { positional: {}, named: {} },
                currentStep: { order: 0 },
                orgId: 1,
            } as any);

            expect(mockList).toHaveBeenCalledWith({
                missionId: 5,
                statuses: ['active', 'waiting_on_human', 'completed'],
            });
            expect(mockList.mock.calls[0][0]).not.toHaveProperty('status');
            expect(mockCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ missionRunId: 10 }));
        });

        it('uses checkpoint:milestone_complete when goldenRecordWritten', async () => {
            mockList.mockResolvedValue([{ id: 10, missionId: 5, missionContext: {}, pipelineExecutionId: 100 }]);
            await hook.onStepComplete({
                result: { success: true },
                pipelineExecution: { id: 100, missionId: 5 },
                pipeline: {},
                context: { positional: {}, named: {} },
                userId: 'agent',
                currentStep: { order: 2 },
                goldenRecordWritten: true,
                orgId: 1,
            } as any);

            expect(mockCheckpoint).toHaveBeenCalledWith(
                expect.objectContaining({
                    reason: 'checkpoint:milestone_complete',
                })
            );
        });

        it('uses system as changedBy when userId is missing', async () => {
            mockList.mockResolvedValue([{ id: 10, missionId: 5, missionContext: {}, pipelineExecutionId: 100 }]);
            await hook.onStepComplete({
                result: { success: true },
                pipelineExecution: { id: 100, missionId: 5 },
                pipeline: {},
                context: { positional: {}, named: {} },
                currentStep: { order: 0 },
                orgId: 1,
            } as any);

            expect(mockCheckpoint).toHaveBeenCalledWith(
                expect.objectContaining({
                    changedBy: 'system',
                })
            );
        });

        it('updates pipelineExecutionId when mission has different execution', async () => {
            mockList.mockResolvedValue([
                { id: 10, missionId: 5, missionContext: {}, pipelineExecutionId: 99 },
            ]);
            await hook.onStepComplete({
                result: { success: true },
                pipelineExecution: { id: 100, missionId: 5 },
                pipeline: {},
                context: { positional: {}, named: {} },
                userId: 'user',
                currentStep: { order: 0 },
                orgId: 1,
            } as any);

            expect(mockUpdate).toHaveBeenCalledWith(10, { pipelineExecutionId: 100 });
        });
    });
});
