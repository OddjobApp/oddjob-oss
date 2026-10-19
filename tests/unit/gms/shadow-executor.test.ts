/**
 * ShadowExecutor tests
 *
 * Coverage for the GMS shadow-validation runner — scenario generation, result
 * aggregation (success rate / latency / cost), and failure-mode analysis that
 * feed the promotion decision. executeVariation is stubbed so no child processes
 * are spawned. Includes a regression for the dead extreme-stress rootCause branch.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi } from 'vitest';
import { ShadowExecutor } from '@server/core/gms/shadow/shadow-executor.js';
import type { BlueprintCandidate, ShadowRunDetail } from '@server/core/gms/common/types.js';

function makeCandidate(id = 'cand-1'): BlueprintCandidate {
    return { id, blueprint: { steps: [{ id: 's1', type: 'agent', name: 's', description: '', config: {} }] } } as any;
}

function run(overrides: Partial<ShadowRunDetail> = {}): ShadowRunDetail {
    return { variationId: 'v', scenarioId: 'scenario_0_normal', success: true, latency: 100, cost: 0.01, ...overrides };
}

describe('ShadowExecutor', () => {
    describe('execute (aggregation)', () => {
        it('aggregates success rate, latency stats, cost, and failure modes', async () => {
            const exec = new ShadowExecutor();
            const queued = [
                { run: run({ success: true, latency: 100, cost: 0.01, scenarioId: 'scenario_0_normal' }) },
                { run: run({ success: true, latency: 300, cost: 0.03, scenarioId: 'scenario_1_normal' }) },
                { run: run({ success: false, latency: 50, cost: 0, error: 'Operation timeout', scenarioId: 'scenario_2_high' }) },
                { run: run({ success: false, latency: 0, cost: 0, error: '429 too many requests', scenarioId: 'scenario_3_high' }) },
            ];
            let i = 0;
            vi.spyOn(exec as any, 'executeVariation').mockImplementation(async () => queued[i++]);

            const result = await exec.execute(makeCandidate(), { nVariations: 4 });

            expect(result.successRate).toBeCloseTo(0.5, 6);
            expect(result.avgLatency).toBeCloseTo(112.5, 6); // (100+300+50+0)/4
            expect(result.minLatency).toBe(0);
            expect(result.maxLatency).toBe(300);
            expect(result.totalCost).toBeCloseTo(0.04, 6);
            expect(result.runs).toHaveLength(4);
            // two distinct failure types -> two modes
            expect(result.failureModes.map(m => m.type).sort()).toEqual(['rate_limit', 'timeout']);
        });

        it('reports a zeroed result set when there are no runs', async () => {
            const exec = new ShadowExecutor();
            // Force an empty scenario set to exercise the empty-runs aggregation guards.
            vi.spyOn(exec as any, 'generateScenarios').mockReturnValue([]);
            vi.spyOn(exec as any, 'executeVariation').mockImplementation(async () => ({ run: run() }));
            const result = await exec.execute(makeCandidate());

            expect(result.runs).toHaveLength(0);
            expect(result.successRate).toBe(0);
            expect(result.avgLatency).toBe(0);
            expect(result.minLatency).toBe(0);
            expect(result.maxLatency).toBe(0);
            expect(result.totalCost).toBe(0);
        });

        it('records a failure run when a variation rejects', async () => {
            const exec = new ShadowExecutor();
            vi.spyOn(exec as any, 'executeVariation').mockImplementation(async () => {
                throw new Error('worker crashed');
            });
            const result = await exec.execute(makeCandidate(), { nVariations: 2 });

            expect(result.runs).toHaveLength(2);
            expect(result.successRate).toBe(0);
            expect(result.runs.every(r => !r.success)).toBe(true);
        });
    });

    describe('generateScenarios', () => {
        const exec = new ShadowExecutor();
        const gen = (n: number) => (exec as any).generateScenarios(n);

        it('produces n scenarios with the stress level encoded in the id', () => {
            const scenarios = gen(5);
            expect(scenarios).toHaveLength(5);
            expect(scenarios[0].id).toBe('scenario_0_normal');
            expect(scenarios[4].id).toBe('scenario_4_extreme');
            expect(scenarios[4].stressLevel).toBe('extreme');
        });

        it('injects a timeout failure into the last scenario only', () => {
            const scenarios = gen(3);
            expect(scenarios[2].failureInjection).toBe('timeout');
            expect(scenarios[0].failureInjection).toBeUndefined();
        });
    });

    describe('categorizeError', () => {
        const exec = new ShadowExecutor();
        const cat = (e: string) => (exec as any).categorizeError(e);

        it('maps messages to failure categories', () => {
            expect(cat('Operation timeout after 30s')).toBe('timeout');
            expect(cat('429 Too Many Requests')).toBe('rate_limit');
            expect(cat('Unauthorized: invalid token')).toBe('auth_error');
            expect(cat('Resource not found (404)')).toBe('not_found');
            expect(cat('Failed to parse JSON')).toBe('parsing_error');
            expect(cat('network connection reset')).toBe('network_error');
            expect(cat('Process OOM killed')).toBe('oom_error');
            expect(cat('something odd happened')).toBe('tool_error');
        });
    });

    describe('analyzeFailures', () => {
        const exec = new ShadowExecutor();
        const analyze = (runs: ShadowRunDetail[]) => (exec as any).analyzeFailures(runs);

        it('returns no modes when all runs succeed', () => {
            expect(analyze([run({ success: true }), run({ success: true })])).toEqual([]);
        });

        it('groups failures by type, sorts by frequency, and sets fixability', () => {
            const runs = [
                run({ success: false, error: 'timeout', scenarioId: 'scenario_0_high' }),
                run({ success: false, error: 'timeout', scenarioId: 'scenario_1_high' }),
                run({ success: false, error: 'Unauthorized', scenarioId: 'scenario_2_normal' }),
                run({ success: true }),
            ];
            const modes = analyze(runs);

            expect(modes[0].type).toBe('timeout'); // most frequent first
            expect(modes[0].frequency).toBe(2);
            expect(modes[0].fixable).toBe(false); // timeout not marked fixable
            const auth = modes.find((m: any) => m.type === 'auth_error');
            expect(auth.frequency).toBe(1);
            expect(auth.fixable).toBe(true);
        });

        it('marks oom failures as not fixable', () => {
            const modes = analyze([run({ success: false, error: 'OOM: out of memory' })]);
            expect(modes[0].type).toBe('oom_error');
            expect(modes[0].fixable).toBe(false);
        });

        it('regression: attributes all-extreme-stress failures to resource exhaustion', () => {
            // Before the id fix, scenarioIds never contained the stress level, so this
            // root cause was unreachable dead code.
            const modes = analyze([
                run({ success: false, error: 'tool blew up', scenarioId: 'scenario_4_extreme' }),
                run({ success: false, error: 'tool blew up again', scenarioId: 'scenario_9_extreme' }),
            ]);
            expect(modes[0].rootCause).toBe('Resource exhaustion under high load');
        });

        it('uses a type-specific root cause when failures are not all extreme', () => {
            const modes = analyze([run({ success: false, error: 'timeout', scenarioId: 'scenario_0_normal' })]);
            expect(modes[0].rootCause).toBe('Insufficient timeout configuration or slow downstream services');
        });
    });

    describe('estimateCost', () => {
        const exec = new ShadowExecutor();
        const cost = (latency: number, traces?: any) => (exec as any).estimateCost(latency, traces);

        it('computes base cost from latency', () => {
            expect(cost(1000)).toBeCloseTo(0.01, 6); // 1s * $0.01
        });

        it('adds a token-based component when a trace is present', () => {
            // base 0.02 + (3*1000/1000)*0.001 = 0.023
            expect(cost(2000, { thoughtDepth: 3 })).toBeCloseTo(0.023, 6);
        });
    });

    describe('status & abort', () => {
        it('getStatus reports active run count and config', () => {
            const exec = new ShadowExecutor({ maxConcurrentRuns: 7 });
            const status = exec.getStatus();
            expect(status.activeRuns).toBe(0);
            expect(status.config.maxConcurrentRuns).toBe(7);
        });

        it('abortAll clears active runs without throwing', async () => {
            const exec = new ShadowExecutor();
            (exec as any).activeRuns.set('r1', new AbortController());
            await exec.abortAll();
            expect(exec.getStatus().activeRuns).toBe(0);
        });
    });
});
