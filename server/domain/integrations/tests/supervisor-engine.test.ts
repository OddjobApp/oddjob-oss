/**
 * SupervisorEngine tests (getReadyTasks, evaluateState - pure logic)
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupervisorEngine } from '../core/supervisor/supervisor-engine.js';
import type { SupervisorPlan, SupervisorTask } from '@shared/schema/supervisor.js';
import { SupervisorState } from '@shared/schema/supervisor.js';

const mockDb = {} as any;

function createEngine(): SupervisorEngine {
    return new SupervisorEngine({
        db: mockDb,
        parentExecutionId: 1,
    });
}

function createTask(overrides: Partial<SupervisorTask> = {}): SupervisorTask {
    return {
        id: 't1',
        type: 'pipeline',
        name: 'Task 1',
        description: 'Do something',
        status: 'pending',
        dependencies: [],
        retryCount: 0,
        estimatedCostUSD: 0,
        ...overrides,
    } as SupervisorTask;
}

function createPlan(tasks: SupervisorTask[]): SupervisorPlan {
    return {
        intent: 'Test plan',
        tasks,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
        estimatedCostUSD: 0,
        replanCount: 0,
        autoRescueEnabled: true,
        history: [],
    };
}

describe('SupervisorEngine', () => {
    const engine = createEngine();

    describe('getReadyTasks', () => {
        it('returns pending tasks with no dependencies', () => {
            const plan = createPlan([
                createTask({ id: 't1', status: 'pending', dependencies: [] }),
                createTask({ id: 't2', status: 'pending', dependencies: [] }),
            ]);
            const ready = engine.getReadyTasks(plan);
            expect(ready).toHaveLength(2);
            expect(ready.map((t) => t.id)).toEqual(['t1', 't2']);
        });

        it('returns only tasks whose dependencies are completed', () => {
            const plan = createPlan([
                createTask({ id: 't1', status: 'completed', dependencies: [] }),
                createTask({ id: 't2', status: 'pending', dependencies: ['t1'] }),
                createTask({ id: 't3', status: 'pending', dependencies: ['t1', 't2'] }),
            ]);
            const ready = engine.getReadyTasks(plan);
            expect(ready).toHaveLength(1);
            expect(ready[0].id).toBe('t2');
        });

        it('returns multiple tasks when all their deps are done', () => {
            const plan = createPlan([
                createTask({ id: 't1', status: 'completed', dependencies: [] }),
                createTask({ id: 't2', status: 'completed', dependencies: [] }),
                createTask({ id: 't3', status: 'pending', dependencies: ['t1'] }),
                createTask({ id: 't4', status: 'pending', dependencies: ['t2'] }),
            ]);
            const ready = engine.getReadyTasks(plan);
            expect(ready).toHaveLength(2);
            expect(ready.map((t) => t.id).sort()).toEqual(['t3', 't4']);
        });

        it('excludes in_progress and failed tasks from ready', () => {
            const plan = createPlan([
                createTask({ id: 't1', status: 'in_progress', dependencies: [] }),
                createTask({ id: 't2', status: 'failed', dependencies: [] }),
            ]);
            const ready = engine.getReadyTasks(plan);
            expect(ready).toHaveLength(0);
        });

        it('treats skipped as completed for dependency resolution', () => {
            const plan = createPlan([
                createTask({ id: 't1', status: 'skipped', dependencies: [] }),
                createTask({ id: 't2', status: 'pending', dependencies: ['t1'] }),
            ]);
            const ready = engine.getReadyTasks(plan);
            expect(ready).toHaveLength(1);
            expect(ready[0].id).toBe('t2');
        });
    });

    describe('evaluateState', () => {
        it('returns COMPLETED when all tasks completed or skipped', () => {
            const plan = createPlan([
                createTask({ id: 't1', status: 'completed' }),
                createTask({ id: 't2', status: 'skipped' }),
            ]);
            expect(engine.evaluateState(plan)).toBe(SupervisorState.COMPLETED);
        });

        it('returns FAILED when any task failed', () => {
            const plan = createPlan([
                createTask({ id: 't1', status: 'completed' }),
                createTask({ id: 't2', status: 'failed' }),
            ]);
            expect(engine.evaluateState(plan)).toBe(SupervisorState.FAILED);
        });

        it('returns TRIAGING when any task rejected without triage result', () => {
            const plan = createPlan([
                createTask({ id: 't1', status: 'completed' }),
                createTask({ id: 't2', status: 'rejected' }),
            ]);
            expect(engine.evaluateState(plan)).toBe(SupervisorState.TRIAGING);
        });

        it('returns WAITING when any task in_progress', () => {
            const plan = createPlan([
                createTask({ id: 't1', status: 'completed' }),
                createTask({ id: 't2', status: 'in_progress' }),
            ]);
            expect(engine.evaluateState(plan)).toBe(SupervisorState.WAITING);
        });

        it('returns DELEGATING when all pending (no in_progress, no failed, no rejected)', () => {
            const plan = createPlan([
                createTask({ id: 't1', status: 'pending' }),
                createTask({ id: 't2', status: 'pending' }),
            ]);
            expect(engine.evaluateState(plan)).toBe(SupervisorState.DELEGATING);
        });

        it('prioritizes triaging over failed when task rejected without triage result', () => {
            const planRejected = createPlan([
                createTask({ id: 't1', status: 'rejected' }),
                createTask({ id: 't2', status: 'failed' }),
            ]);
            expect(engine.evaluateState(planRejected)).toBe(SupervisorState.TRIAGING);
        });
    });
});


