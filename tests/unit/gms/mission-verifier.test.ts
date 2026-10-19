/**
 * MissionVerifier tests
 *
 * Coverage for the GMS deploy gate — the classifier whose successProbability
 * decides which synthesized blueprints get promoted. Pure scoring/risk logic,
 * plus a regression for the calculateConfidence operator-precedence bug.
 *
 * The trace-embedder module is mocked so importing the verifier doesn't pull in
 * the real AI client; a lightweight embedder stub is injected instead.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@server/core/gms/embeddings/trace-embedder.js', () => ({
    TraceEmbeddingEngine: class {},
    MockEmbeddingEngine: class {},
}));

import { MissionVerifier, PretrainedMissionVerifier } from '@server/core/gms/verifier/mission-verifier.js';
import type { EnrichedHermesTrace, HermesTraceFeatures } from '@server/core/gms/common/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeEmbedder(embedding: number[] = [], throws = false) {
    return {
        embedTrace: vi.fn(async () => {
            if (throws) throw new Error('embedder down');
            return embedding;
        }),
    } as any;
}

function makeTrace(
    features: Partial<HermesTraceFeatures> = {},
    extra: Partial<EnrichedHermesTrace> = {},
): EnrichedHermesTrace {
    return {
        parsed: { toolCalls: [] } as any,
        traceId: 't1',
        startTime: new Date(),
        endTime: new Date(),
        latencyMs: 1000,
        tokenUsage: { total: 2000, prompt: 1000, completion: 1000 },
        features: {
            thoughtDepth: 3,
            toolDiversity: 0.5,
            selfReflectionIndicators: [],
            confidenceMarkers: 0,
            recursionDepth: 1,
            actionChaining: 2,
            ...features,
        },
        ...extra,
    } as EnrichedHermesTrace;
}

describe('MissionVerifier', () => {
    describe('scoreTrace', () => {
        it('returns a probability bounded to [0,1] with a passed-through embedding', async () => {
            const embedding = [0.1, 0.2, 0.3];
            const v = new MissionVerifier(makeEmbedder(embedding));

            const score = await v.scoreTrace(makeTrace());

            expect(score.successProbability).toBeGreaterThanOrEqual(0);
            expect(score.successProbability).toBeLessThanOrEqual(1);
            expect(score.confidence).toBeLessThanOrEqual(1);
            expect(score.embedding).toEqual(embedding);
        });

        it('returns a conservative fallback when the embedder throws', async () => {
            const v = new MissionVerifier(makeEmbedder([], true));

            const score = await v.scoreTrace(makeTrace());

            expect(score.successProbability).toBe(0.5);
            expect(score.confidence).toBe(0.1);
            expect(score.embedding).toEqual([]);
            expect(score.riskFactors[0].type).toBe('tool_failure');
        });

        it('honors riskAnalysisEnabled=false (no risk factors)', async () => {
            const v = new MissionVerifier(makeEmbedder(), { riskAnalysisEnabled: false });
            const score = await v.scoreTrace(makeTrace({ confidenceMarkers: 20 }));
            expect(score.riskFactors).toEqual([]);
        });
    });

    describe('analyzeRisks', () => {
        const v = new MissionVerifier(makeEmbedder());
        const risks = (t: EnrichedHermesTrace) => (v as any).analyzeRisks(t);

        it('flags hallucination (high severity) for many uncertainty markers', () => {
            const r = risks(makeTrace({ confidenceMarkers: 12 }));
            const hallucination = r.find((x: any) => x.type === 'hallucination');
            expect(hallucination).toBeDefined();
            expect(hallucination.severity).toBe('high');
        });

        it('flags hallucination as medium between 5 and 10 markers', () => {
            const r = risks(makeTrace({ confidenceMarkers: 7 }));
            expect(r.find((x: any) => x.type === 'hallucination').severity).toBe('medium');
        });

        it('does not flag hallucination at or below the threshold', () => {
            const r = risks(makeTrace({ confidenceMarkers: 5 }));
            expect(r.find((x: any) => x.type === 'hallucination')).toBeUndefined();
        });

        it('flags timeout risk for deep recursion', () => {
            const r = risks(makeTrace({ recursionDepth: 4 }));
            expect(r.find((x: any) => x.type === 'timeout')).toBeDefined();
        });

        it('flags tool_failure for long action chains', () => {
            const r = risks(makeTrace({ actionChaining: 9 }));
            expect(r.find((x: any) => x.type === 'tool_failure')).toBeDefined();
        });

        it('flags overconfidence when complex reasoning has no self-reflection', () => {
            const r = risks(makeTrace({ thoughtDepth: 5, selfReflectionIndicators: [] }));
            expect(r.find((x: any) => x.type === 'data_quality')).toBeDefined();
        });

        it('returns no risks for a clean trace', () => {
            const r = risks(makeTrace({
                confidenceMarkers: 0, recursionDepth: 1, actionChaining: 1,
                thoughtDepth: 1, selfReflectionIndicators: ['I should verify'],
            }));
            expect(r).toEqual([]);
        });
    });

    describe('calculateConfidence (regression: additive feature score)', () => {
        const v = new MissionVerifier(makeEmbedder());
        const conf = (t: EnrichedHermesTrace, emb: number[] = []) =>
            (v as any).calculateConfidence(t, emb);

        it('adds BOTH thoughtDepth and toolDiversity contributions (0.5 + 0.1 + 0.1)', () => {
            // Fresh verifier: totalSamples=0 -> +0; empty embedding -> +0.
            const c = conf(makeTrace({ thoughtDepth: 2, toolDiversity: 0.5 }));
            expect(c).toBeCloseTo(0.7, 5);
        });

        it('adds only one contribution when a feature is absent', () => {
            const c = conf(makeTrace({ thoughtDepth: 2, toolDiversity: 0 }));
            expect(c).toBeCloseTo(0.6, 5);
        });

        it('caps confidence at 1.0', () => {
            // Large embedding norm pushes the embedding factor to its 0.2 cap.
            const big = new Array(16).fill(1);
            const c = conf(makeTrace({ thoughtDepth: 2, toolDiversity: 0.5 }), big);
            expect(c).toBeLessThanOrEqual(1);
        });
    });

    describe('getFeatureValue normalization', () => {
        const v = new MissionVerifier(makeEmbedder());
        const val = (name: string, f: Partial<HermesTraceFeatures>) =>
            (v as any).getFeatureValue(makeTrace(f).features, name);

        it('normalizes thoughtDepth by 10', () => {
            expect(val('thoughtDepth', { thoughtDepth: 5 })).toBe(0.5);
        });

        it('clamps selfReflection to a max of 1', () => {
            expect(val('selfReflection', { selfReflectionIndicators: ['a', 'b', 'c', 'd', 'e', 'f'] })).toBe(1);
        });

        it('clamps confidence markers to a max of 1', () => {
            expect(val('confidence', { confidenceMarkers: 20 })).toBe(1);
        });

        it('returns 0 for an unknown feature name', () => {
            expect(val('nonsense', {})).toBe(0);
        });
    });

    describe('predictFromFeatures / calibrate bounds', () => {
        const v = new MissionVerifier(makeEmbedder());

        it('predictFromFeatures stays within [0,1] even for extreme features', () => {
            const p = (v as any).predictFromFeatures(
                makeTrace({ thoughtDepth: 1000, actionChaining: 1000 }).features,
                [],
            );
            expect(p).toBeGreaterThanOrEqual(0);
            expect(p).toBeLessThanOrEqual(1);
        });

        it('calibrate stays within [0,1]', () => {
            expect((v as any).calibrate(5)).toBeLessThanOrEqual(1);
            expect((v as any).calibrate(-5)).toBeGreaterThanOrEqual(0);
        });

        it('extractEmbeddingSignal is bounded to [-1,1]', () => {
            const hi = (v as any).extractEmbeddingSignal(new Array(10).fill(100));
            const lo = (v as any).extractEmbeddingSignal(new Array(10).fill(-100));
            expect(hi).toBeLessThanOrEqual(1);
            expect(lo).toBeGreaterThanOrEqual(-1);
        });
    });

    describe('estimateMetrics', () => {
        const v = new MissionVerifier(makeEmbedder());

        it('scales latency with thought depth and tool calls', () => {
            const trace = makeTrace({ thoughtDepth: 2 }, { parsed: { toolCalls: [{}, {}] } as any });
            // 1000 base + 2*500 + 2*2000 = 6000
            const { latency } = (v as any).estimateMetrics(trace);
            expect(latency).toBe(6000);
        });

        it('derives cost from token usage', () => {
            const trace = makeTrace({}, { latencyMs: 1000, tokenUsage: { total: 5000, prompt: 0, completion: 0 } });
            // 5000/1000 * 0.001 = 0.005
            const { cost } = (v as any).estimateMetrics(trace);
            expect(cost).toBeCloseTo(0.005, 6);
        });
    });

    describe('scoreBlueprint / heuristicScore', () => {
        const v = new MissionVerifier(makeEmbedder());

        it('uses heuristicScore (low confidence) when no simulated trace is given', async () => {
            const score = await v.scoreBlueprint({ steps: [{}, {}, {}], tools: [{ name: 'a' }, { name: 'a' }, { name: 'b' }] });
            expect(score.confidence).toBe(0.3);
            expect(score.successProbability).toBeGreaterThanOrEqual(0.3);
            expect(score.successProbability).toBeLessThanOrEqual(1);
        });

        it('bottoms out at 0.5 for arbitrarily complex blueprints (penalty caps at 0.2)', async () => {
            // complexityPenalty is capped at 0.2, so 0.7 - 0.2 = 0.5 is the practical
            // minimum — the max(0.3, ...) floor in heuristicScore is never actually reached.
            const huge = { steps: new Array(100).fill({}), tools: [] };
            const score = await v.scoreBlueprint(huge);
            expect(score.successProbability).toBeCloseTo(0.5, 5);
        });

        it('delegates to scoreTrace when a simulated trace is provided', async () => {
            const spy = vi.spyOn(v, 'scoreTrace');
            await v.scoreBlueprint({ steps: [] }, makeTrace());
            expect(spy).toHaveBeenCalledOnce();
            spy.mockRestore();
        });
    });

    describe('model persistence & online update', () => {
        it('exportModel / importModel round-trips weights', () => {
            const v = new MissionVerifier(makeEmbedder());
            const exported = v.exportModel() as any;
            expect(exported.featureWeights.thoughtDepth).toBeDefined();

            const v2 = new MissionVerifier(makeEmbedder());
            v2.importModel({ featureWeights: { thoughtDepth: 0.99 }, calibrationParams: { mean: 0.4, std: 0.1 } });
            expect((v2.exportModel() as any).featureWeights.thoughtDepth).toBe(0.99);
        });

        it('updateFromResult shifts weights and bumps sample counts', async () => {
            const v = new MissionVerifier(makeEmbedder());
            const before = (v.exportModel() as any).featureWeights.thoughtDepth;

            await v.updateFromResult(makeTrace({ thoughtDepth: 8 }), true);

            const after = (v.exportModel() as any).featureWeights.thoughtDepth;
            expect(after).not.toBe(before);
            expect(v.getStats().totalSamples).toBe(1);
            expect(v.getStats().positiveSamples).toBe(1);
        });

        it('getStats returns a copy, not the internal object', () => {
            const v = new MissionVerifier(makeEmbedder());
            const s = v.getStats();
            s.totalSamples = 999;
            expect(v.getStats().totalSamples).toBe(0);
        });
    });

    describe('PretrainedMissionVerifier', () => {
        it('boots with the pre-trained feature weights', () => {
            const v = new PretrainedMissionVerifier(makeEmbedder());
            const weights = (v.exportModel() as any).featureWeights;
            expect(weights.selfReflection).toBe(0.25);
            expect(weights.confidence).toBe(-0.20);
        });
    });
});
