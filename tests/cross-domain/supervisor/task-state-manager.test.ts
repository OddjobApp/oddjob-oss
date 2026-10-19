/**
 * TaskStateManager tests — task status transitions and retry logic
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskStateManager } from "@domain/mission/supervisor/task-state-manager.js";
import type { SupervisorPlan, SupervisorTask } from '@shared/schema/supervisor.js';

vi.mock('../../../server/utils/logger.js', () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    })),
}));

function createTask(overrides: Partial<SupervisorTask> = {}): SupervisorTask {
    return {
        id: 't1',
        type: 'pipeline',
        name: 'Task 1',
        description: 'Do something',
        status: 'pending',
        dependencies: [],
        ...overrides,
    };
}

function createPlan(tasks: SupervisorTask[] = []): SupervisorPlan {
    return {
        intent: 'Test plan',
        tasks,
        history: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

describe('TaskStateManager', () => {
    describe('transitionToInProgress', () => {
        it('sets status to in_progress and stores execution ids', () => {
            const task = createTask({ status: 'pending' });
            TaskStateManager.transitionToInProgress(task, 42, 100);

            expect(task.status).toBe('in_progress');
            expect(task.childExecutionId).toBe(42);
            expect(task.pipelineId).toBe(100);
        });
    });

    describe('completeTask', () => {
        it('sets status to completed and stores output', () => {
            const task = createTask({ status: 'in_progress' });
            const output = { result: 'done', count: 5 };

            TaskStateManager.completeTask(task, output);

            expect(task.status).toBe('completed');
            expect(task.output).toEqual(output);
        });
    });

    describe('handleFailure', () => {
        it('returns true and resets to pending when retry count < 3', () => {
            const task = createTask({ status: 'in_progress', retryCount: 0, childExecutionId: 99 });
            const plan = createPlan([task]);

            const result = TaskStateManager.handleFailure(task, 'Connection timeout', plan);

            expect(result).toBe(true);
            expect(task.status).toBe('pending');
            expect(task.retryCount).toBe(1);
            expect(task.childExecutionId).toBeUndefined();
            expect(plan.history).toHaveLength(1);
            expect(plan.history[0].type).toBe('thought');
            expect(plan.history[0].observation).toContain('Retrying');
            expect(plan.history[0].observation).toContain('Attempt 1');
        });

        it('increments retry count on each failure', () => {
            const task = createTask({ status: 'in_progress', retryCount: 1 });
            const plan = createPlan([task]);

            TaskStateManager.handleFailure(task, 'Error', plan);

            expect(task.retryCount).toBe(2);
            expect(task.status).toBe('pending');
        });

        it('returns false and sets failed when retry count reaches 3', () => {
            const task = createTask({ status: 'in_progress', retryCount: 3 });
            const plan = createPlan([task]);

            const result = TaskStateManager.handleFailure(task, 'Final error', plan);

            expect(result).toBe(false);
            expect(task.status).toBe('failed');
            expect(task.output).toEqual({ error: 'Final error' });
            expect(task.retryCount).toBe(3);
        });

        it('treats undefined retryCount as 0', () => {
            const task = createTask({ status: 'in_progress' });
            const plan = createPlan([task]);

            const result = TaskStateManager.handleFailure(task, 'First fail', plan);

            expect(result).toBe(true);
            expect(task.retryCount).toBe(1);
        });
    });

    describe('handleRejection', () => {
        it('sets status to rejected and stores feedback', () => {
            const task = createTask({ status: 'in_progress' });
            const plan = createPlan([task]);
            const feedback = 'Please add more detail to the output';

            TaskStateManager.handleRejection(task, feedback, plan);

            expect(task.status).toBe('rejected');
            expect(task.assignedAgentFeedback).toBe(feedback);
            expect(plan.history).toHaveLength(1);
            expect(plan.history[0].type).toBe('critique');
            expect(plan.history[0].observation).toContain('rejected');
            expect(plan.history[0].observation).toContain(feedback);
        });
    });
});
