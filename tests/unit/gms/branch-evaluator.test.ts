/**
 * BranchEvaluator tests
 *
 * Coverage for the GMS selection gate: multi-objective scoring, hard-constraint
 * filtering, Pareto-frontier identification, ranking, and top-K selection that
 * decide which synthesized candidates advance to (expensive) shadow validation.
 *
 * verifier and simulator are `import type` only, so no module mocking is needed —
 * lightweight stubs are injected via the constructor.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi } from 'vitest';
import { BranchEvaluator } from '@server/core/gms/pmi/branch-evaluator.js';
import type { BlueprintCandidate, VerifierScore, SimulationResult } from '@server/core/gms/common/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeCandidate(id: string, stepCount = 2): BlueprintCandidate {
    return {
        id,
        blueprint: { steps: new Array(stepCount).fill({ id: 's', type: 'agent', name: 's', description: '', config: {} }) },
    } as any;
}

function makeScore(overrides: Partial<VerifierScore> = {}): VerifierScore {
    return {
        successProbability: 0.8,
        confidence: 0.5,
        latencyEstimate: 1000,
        costEstimate: 0.01,
        riskFactors: [],
        ...overrides,
    };
}

function makeSim(duration = 1000): SimulationResult {
    return { duration } as any;
}

/** A scored item as consumed by the private scoring/filtering/ranking methods. */
function item(id: string, opts: { successProbability?: number; costEstimate?: number; confidence?: number; riskFactors?: Array<{ severity: string }>; duration?: number } = {}) {
    // Default each field so we never spread `undefined` over makeScore's defaults.
    return {
        candidate: makeCandidate(id),
        simulation: makeSim(opts.duration ?? 1000),
        verifierScore: makeScore({
            successProbability: opts.successProbability ?? 0.8,
            costEstimate: opts.costEstimate ?? 0.01,
            confidence: opts.confidence ?? 0.5,
            riskFactors: (opts.riskFactors ?? []) as any,
        }),
    };
}

/**
 * Build an evaluator with map-driven stubs.
 * simulate() and scoreTrace() resolve per-candidate via id (toHermesTrace tags the id).
 */
function makeEvaluator(
    scores: Record<string, VerifierScore> = {},
    sims: Record<string, SimulationResult> = {},
    config = {},
    opts: { simulateThrows?: boolean } = {},
) {
    const simulator = {
        simulate: vi.fn(async (c: any) => {
            if (opts.simulateThrows) throw new Error('sim down');
            return sims[c.id] ?? makeSim(1000);
        }),
        toHermesTrace: vi.fn((c: any) => ({ __id: c.id })),
    } as any;
    const verifier = {
        scoreTrace: vi.fn(async (trace: any) => scores[trace.__id] ?? makeScore()),
    } as any;
    return { ev: new BranchEvaluator(verifier, simulator, config), simulator, verifier };
}

describe('BranchEvaluator', () => {
    describe('calculateRiskScore', () => {
        const { ev } = makeEvaluator();
        const risk = (rf: Array<{ severity: string }>) => (ev as any).calculateRiskScore(rf);

        it('sums severity weights', () => {
            expect(risk([{ severity: 'low' }, { severity: 'critical' }])).toBe(6); // 1 + 5
            expect(risk([{ severity: 'medium' }, { severity: 'high' }])).toBe(5); // 2 + 3
        });
        it('treats unknown severities as 1 and empty as 0', () => {
            expect(risk([{ severity: 'weird' }])).toBe(1);
            expect(risk([])).toBe(0);
        });
    });

    describe('calculateCompositeScores', () => {
        const { ev } = makeEvaluator(); // default weights & thresholds

        it('yields 1.0 for a perfect candidate', () => {
            const [scored] = (ev as any).calculateCompositeScores([
                item('a', { successProbability: 1, duration: 0, costEstimate: 0, confidence: 1, riskFactors: [] }),
            ]);
            expect(scored.compositeScore).toBeCloseTo(1, 6);
        });

        it('applies the weighted multi-objective formula', () => {
            // success 0.5, duration 15000/30000 -> normLatency 0.5, cost 0.5 -> normCost 0.5,
            // risk 'high'=3 -> normRisk 1-0.3=0.7, confidence 0.5
            // 0.4*0.5 + 0.15*0.5 + 0.15*0.5 + 0.15*0.7 + 0.15*0.5 = 0.53
            const [scored] = (ev as any).calculateCompositeScores([
                item('a', { successProbability: 0.5, duration: 15000, costEstimate: 0.5, confidence: 0.5, riskFactors: [{ severity: 'high' }] }),
            ]);
            expect(scored.compositeScore).toBeCloseTo(0.53, 6);
        });
    });

    describe('identifyParetoFrontier', () => {
        const { ev } = makeEvaluator();

        it('flags dominated candidates as non-optimal and keeps trade-offs on the frontier', () => {
            const a = item('a', { successProbability: 0.9, duration: 100, costEstimate: 0.1, riskFactors: [] });
            const b = item('b', { successProbability: 0.8, duration: 200, costEstimate: 0.2, riskFactors: [{ severity: 'low' }] }); // dominated by a
            const c = item('c', { successProbability: 0.7, duration: 50, costEstimate: 0.05, riskFactors: [] }); // trade-off vs a

            const result = (ev as any).identifyParetoFrontier([a, b, c].map(x => ({ ...x, compositeScore: 0 })));
            const opt = Object.fromEntries(result.map((r: any) => [r.candidate.id, r.paretoOptimal]));

            expect(opt.a).toBe(true);
            expect(opt.b).toBe(false);
            expect(opt.c).toBe(true);
        });

        it('keeps identical candidates all optimal (no strict domination)', () => {
            const x = { ...item('x', { successProbability: 0.8, duration: 100, costEstimate: 0.1 }), compositeScore: 0 };
            const y = { ...item('y', { successProbability: 0.8, duration: 100, costEstimate: 0.1 }), compositeScore: 0 };
            const result = (ev as any).identifyParetoFrontier([x, y]);
            expect(result.every((r: any) => r.paretoOptimal)).toBe(true);
        });
    });

    describe('rankCandidates', () => {
        const { ev } = makeEvaluator();

        it('sorts by composite score descending and assigns 1-based ranks', () => {
            const input = [
                { ...item('lo'), compositeScore: 0.3, paretoOptimal: true },
                { ...item('hi'), compositeScore: 0.9, paretoOptimal: true },
                { ...item('mid'), compositeScore: 0.6, paretoOptimal: false },
            ];
            const ranked = (ev as any).rankCandidates(input);
            expect(ranked.map((r: any) => r.id)).toEqual(['hi', 'mid', 'lo']);
            expect(ranked.map((r: any) => r.rank)).toEqual([1, 2, 3]);
            expect(ranked.every((r: any) => r.recommended === false)).toBe(true);
        });
    });

    describe('filterByConstraints', () => {
        const { ev } = makeEvaluator(); // min success 0.6, maxLatency 30000, maxCost 1.0, maxRisk 5

        it('separates passing from constraint-violating candidates', () => {
            const items = [
                item('ok', { successProbability: 0.8, duration: 1000, costEstimate: 0.1, riskFactors: [] }),
                item('lowSuccess', { successProbability: 0.5 }),
                item('slow', { successProbability: 0.9, duration: 40000 }),
                item('expensive', { successProbability: 0.9, costEstimate: 2.0 }),
                item('risky', { successProbability: 0.9, riskFactors: [{ severity: 'critical' }, { severity: 'critical' }] }), // 10 > 5
            ];
            const { passed, rejected } = (ev as any).filterByConstraints(items);
            expect(passed.map((p: any) => p.candidate.id)).toEqual(['ok']);
            expect(rejected.map((r: any) => r.candidate.id).sort()).toEqual(['expensive', 'lowSuccess', 'risky', 'slow']);
        });
    });

    describe('calculateMetrics', () => {
        const { ev } = makeEvaluator();

        it('aggregates over evaluated candidates', () => {
            const evaluated = [
                { ...item('a', { successProbability: 0.9, costEstimate: 0.2, duration: 1000 }), compositeScore: 0.8, rank: 1, paretoOptimal: true, recommended: true },
                { ...item('b', { successProbability: 0.7, costEstimate: 0.4, duration: 3000 }), compositeScore: 0.6, rank: 2, paretoOptimal: false, recommended: false },
            ].map(x => ({ ...x.candidate, ...x }));
            const rejected = [item('r')];

            const m = (ev as any).calculateMetrics(evaluated, rejected);
            expect(m.totalCandidates).toBe(3);
            expect(m.passedConstraints).toBe(2);
            expect(m.rejectedCount).toBe(1);
            expect(m.avgSuccessProbability).toBeCloseTo(0.8, 6);
            expect(m.avgCompositeScore).toBeCloseTo(0.7, 6);
            expect(m.paretoOptimalCount).toBe(1);
        });

        it('returns a zeroed summary when nothing passed', () => {
            const m = (ev as any).calculateMetrics([], [item('r1'), item('r2')]);
            expect(m.totalCandidates).toBe(2);
            expect(m.passedConstraints).toBe(0);
            expect(m.avgSuccessProbability).toBe(0);
        });
    });

    describe('evaluateCandidates (integration)', () => {
        it('scores, ranks, selects top-K, and marks the recommendation', async () => {
            const { ev } = makeEvaluator(
                {
                    a: makeScore({ successProbability: 0.95, confidence: 0.9, costEstimate: 0.05 }),
                    b: makeScore({ successProbability: 0.7, confidence: 0.5 }),
                    low: makeScore({ successProbability: 0.4 }), // fails min success
                },
                { a: makeSim(500), b: makeSim(1500), low: makeSim(1000) },
            );

            const res = await ev.evaluateCandidates([makeCandidate('a'), makeCandidate('b'), makeCandidate('low')]);

            expect(res.rejected.map(r => r.id)).toEqual(['low']);
            expect(res.recommended?.id).toBe('a');
            expect(res.recommended?.recommended).toBe(true);
            expect(res.topCandidates[0].id).toBe('a');
            expect(res.evaluated.map(e => e.rank)).toEqual([1, 2]);
            expect(res.metrics.totalCandidates).toBe(3);
            expect(res.metrics.rejectedCount).toBe(1);
        });

        it('uses placeholder simulations when simulate=false (simulator.simulate not called)', async () => {
            const { ev, simulator } = makeEvaluator({ a: makeScore({ successProbability: 0.9 }) });
            const res = await ev.evaluateCandidates([makeCandidate('a', 4)], { simulate: false });

            expect(simulator.simulate).not.toHaveBeenCalled();
            expect(simulator.toHermesTrace).toHaveBeenCalled(); // still scored
            // placeholder duration = stepCount * 1000
            expect(res.evaluated[0].simulation.duration).toBe(4000);
        });

        it('survives a simulator failure via the failed-simulation placeholder', async () => {
            const { ev } = makeEvaluator({ a: makeScore({ successProbability: 0.9 }) }, {}, {}, { simulateThrows: true });
            const res = await ev.evaluateCandidates([makeCandidate('a')]);
            // failed sim has duration 0 -> passes latency constraint; pipeline does not throw
            expect(res.evaluated[0].simulation.duration).toBe(0);
        });

        it('returns empty results and a zeroed metrics summary for no candidates', async () => {
            const { ev } = makeEvaluator();
            const res = await ev.evaluateCandidates([]);
            expect(res.evaluated).toEqual([]);
            expect(res.recommended).toBeNull();
            expect(res.metrics.totalCandidates).toBe(0);
        });

        it('respects the configured topK limit', async () => {
            const { ev } = makeEvaluator(
                { a: makeScore(), b: makeScore(), c: makeScore(), d: makeScore() },
                {},
                { topK: 2 },
            );
            const res = await ev.evaluateCandidates(
                ['a', 'b', 'c', 'd'].map(id => makeCandidate(id)),
                { simulate: false },
            );
            expect(res.topCandidates).toHaveLength(2);
            expect(res.evaluated).toHaveLength(4); // all passed, but only 2 selected
        });

        // The MCP tool gms_synthesize_missions advertises a topK parameter. It used
        // to be dropped on the floor: SynthesizeRequest.options had no topK field and
        // the evaluator only ever read this.config.topK, so asking for a different
        // number silently returned the engine default.
        describe('per-request topK override', () => {
            const fourCandidates = () => ['a', 'b', 'c', 'd'].map(id => makeCandidate(id));
            const fourScores = { a: makeScore(), b: makeScore(), c: makeScore(), d: makeScore() };

            it('overrides the configured topK for this call only', async () => {
                const { ev } = makeEvaluator(fourScores, {}, { topK: 2 });

                const overridden = await ev.evaluateCandidates(fourCandidates(), { simulate: false, topK: 3 });
                expect(overridden.topCandidates).toHaveLength(3);

                // The evaluator's own config is untouched by the override.
                const next = await ev.evaluateCandidates(fourCandidates(), { simulate: false });
                expect(next.topCandidates).toHaveLength(2);
            });

            it('falls back to the configured topK when no override is given', async () => {
                const { ev } = makeEvaluator(fourScores, {}, { topK: 1 });
                const res = await ev.evaluateCandidates(fourCandidates(), { simulate: false });
                expect(res.topCandidates).toHaveLength(1);
            });

            it.each([
                ['zero', 0],
                ['negative', -1],
                ['fractional', 2.5],
            ])('ignores a %s override rather than mis-slicing', async (_label, bad) => {
                // slice(0, 0) is empty and slice(0, -1) drops the last element, so an
                // unguarded override would quietly return the wrong candidate set.
                const { ev } = makeEvaluator(fourScores, {}, { topK: 2 });
                const res = await ev.evaluateCandidates(fourCandidates(), { simulate: false, topK: bad as number });
                expect(res.topCandidates).toHaveLength(2);
            });

            it('marks the first of the overridden selection as recommended', async () => {
                const { ev } = makeEvaluator(fourScores, {}, { topK: 1 });
                const res = await ev.evaluateCandidates(fourCandidates(), { simulate: false, topK: 3 });
                expect(res.topCandidates).toHaveLength(3);
                expect(res.recommended).not.toBeNull();
                expect(res.recommended!.id).toBe(res.topCandidates[0].id);
            });
        });
    });
});
