/**
 * GroundTruthCollector tests
 *
 * Coverage for the GMS calibration/feedback loop — recording predicted-vs-actual
 * outcomes, surprise classification, calibration metrics (MAE/RMSE/ECE/bias),
 * drift detection, and the heuristic-distillation trigger (with cooldown).
 *
 * The heuristic-distiller module is mocked so the dynamic import in record() is a
 * no-op we can assert against.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const distillMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@server/domain/agents/core/heuristic-distiller.service.js', () => ({
    heuristicDistillerService: { distill: (...args: any[]) => distillMock(...args) },
}));

import { GroundTruthCollector } from '@server/core/gms/shadow/ground-truth.js';
import type { ShadowResult, VerifierScore } from '@server/core/gms/common/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function prediction(overrides: Partial<VerifierScore> = {}): VerifierScore {
    return {
        successProbability: 0.9,
        confidence: 0.8,
        latencyEstimate: 1000,
        costEstimate: 0.01,
        riskFactors: [],
        ...overrides,
    };
}

function actual(successRate: number, overrides: Partial<ShadowResult> = {}): ShadowResult {
    return {
        candidateId: 'c1',
        completedAt: new Date(),
        successRate,
        avgLatency: 1200,
        minLatency: 800,
        maxLatency: 1600,
        totalCost: 0.05,
        runs: [],
        hermesTraces: [],
        failureModes: [],
        predictionDelta: 0,
        ...overrides,
    };
}

describe('GroundTruthCollector', () => {
    describe('record', () => {
        it('computes prediction error, surprise level, and derived fields', () => {
            const gt = new GroundTruthCollector();
            const entry = gt.record('c1', prediction({ successProbability: 0.9, confidence: 0.8 }), actual(0.2));

            expect(entry.predictionError).toBeCloseTo(0.7, 6);
            expect(entry.surprise).toBe('high'); // > 0.5
            expect(entry.actualSuccess).toBe(false); // 0.2 <= 0.5
            expect(entry.withinConfidence).toBe(false); // 0.7 > (1 - 0.8)
        });

        it('classifies surprise across all thresholds', () => {
            const gt = new GroundTruthCollector();
            expect(gt.record('c', prediction({ successProbability: 0.9 }), actual(0.85)).surprise).toBe('none'); // 0.05
            expect(gt.record('c', prediction({ successProbability: 0.9 }), actual(0.7)).surprise).toBe('low');   // 0.20
            expect(gt.record('c', prediction({ successProbability: 0.9 }), actual(0.5)).surprise).toBe('medium'); // 0.40
            expect(gt.record('c', prediction({ successProbability: 0.9 }), actual(0.2)).surprise).toBe('high');   // 0.70
        });

        it('flags withinConfidence when error fits inside the confidence width', () => {
            const gt = new GroundTruthCollector();
            // confidence 0.9 -> width 0.1; error 0.05 fits
            const e = gt.record('c', prediction({ successProbability: 0.9, confidence: 0.9 }), actual(0.85));
            expect(e.withinConfidence).toBe(true);
        });

        it('maps predicted risks and actual failure modes', () => {
            const gt = new GroundTruthCollector();
            const e = gt.record(
                'c',
                prediction({ riskFactors: [{ type: 'timeout', severity: 'high', description: '' }] as any }),
                actual(0.9, { failureModes: [{ type: 'timeout', frequency: 1, scenarioIds: [], description: '', fixable: false }] as any }),
            );
            expect(e.predictedRisks).toEqual(['timeout']);
            expect(e.actualFailures).toEqual(['timeout']);
        });

        it('evicts the oldest entry beyond maxEntries', () => {
            const gt = new GroundTruthCollector(2);
            gt.record('a', prediction(), actual(0.9));
            gt.record('b', prediction(), actual(0.9));
            gt.record('c', prediction(), actual(0.9));
            expect(gt.getSummary().totalObservations).toBe(2);
        });
    });

    describe('getSummary', () => {
        it('returns zeros when empty', () => {
            expect(new GroundTruthCollector().getSummary()).toEqual({
                totalObservations: 0, avgPredictionError: 0, highSurpriseCount: 0, withinConfidenceRate: 0,
            });
        });

        it('aggregates observations', () => {
            const gt = new GroundTruthCollector();
            gt.record('a', prediction({ successProbability: 0.9, confidence: 0.9 }), actual(0.85)); // err .05, within
            gt.record('b', prediction({ successProbability: 0.9 }), actual(0.1)); // err .8, high, not within
            const s = gt.getSummary();
            expect(s.totalObservations).toBe(2);
            expect(s.avgPredictionError).toBeCloseTo((0.05 + 0.8) / 2, 6);
            expect(s.highSurpriseCount).toBe(1);
            expect(s.withinConfidenceRate).toBeCloseTo(0.5, 6);
        });
    });

    describe('getSurprises', () => {
        it('filters entries at or above the requested surprise level', () => {
            const gt = new GroundTruthCollector();
            gt.record('none', prediction({ successProbability: 0.9 }), actual(0.85)); // none
            gt.record('low', prediction({ successProbability: 0.9 }), actual(0.7));   // low
            gt.record('high', prediction({ successProbability: 0.9 }), actual(0.1));  // high

            expect(gt.getSurprises('high')).toHaveLength(1);
            expect(gt.getSurprises('low')).toHaveLength(2);
            expect(gt.getSurprises('medium')).toHaveLength(1);
        });
    });

    describe('checkFailurePrediction', () => {
        const gt = new GroundTruthCollector();

        it('splits into correctly predicted, missed, and false positives', () => {
            const res = gt.checkFailurePrediction(['timeout', 'network_error'], ['timeout', 'auth_error']);
            expect(res.predictedCorrectly).toEqual(['timeout']);
            expect(res.missed).toEqual(['network_error']);
            expect(res.falsePositives).toEqual(['auth_error']);
        });
    });

    describe('calculateMetrics', () => {
        it('returns empty metrics with no data', () => {
            const m = new GroundTruthCollector().calculateMetrics();
            expect(m.meanAbsoluteError).toBe(0);
            expect(m.reliabilityDiagram).toEqual([]);
            expect(m.driftDetected).toBe(false);
        });

        it('computes MAE, RMSE, systematic bias, and a 10-bin reliability diagram', () => {
            const gt = new GroundTruthCollector();
            gt.record('a', prediction({ successProbability: 0.9 }), actual(0.7)); // err 0.2, bias +0.2
            gt.record('b', prediction({ successProbability: 0.5 }), actual(0.9)); // err 0.4, bias -0.4

            const m = gt.calculateMetrics();
            expect(m.meanAbsoluteError).toBeCloseTo(0.3, 6);
            expect(m.rootMeanSquareError).toBeCloseTo(Math.sqrt((0.04 + 0.16) / 2), 6);
            expect(m.systematicBias).toBeCloseTo((0.2 + -0.4) / 2, 6);
            expect(m.reliabilityDiagram).toHaveLength(10);
            expect(m.expectedCalibrationError).toBeGreaterThanOrEqual(0);
        });

        it('bins predictions by predicted-success in the reliability diagram', () => {
            const gt = new GroundTruthCollector();
            // Two predictions at 0.85 -> bin index 8; one succeeds (rate>0.5), one fails.
            gt.record('a', prediction({ successProbability: 0.85 }), actual(0.9));
            gt.record('b', prediction({ successProbability: 0.85 }), actual(0.2));

            const bin8 = gt.calculateMetrics().reliabilityDiagram[8];
            expect(bin8.confidence).toBeCloseTo(0.85, 6);
            expect(bin8.accuracy).toBeCloseTo(0.5, 6); // 1 of 2 succeeded
        });
    });

    describe('detectDrift (via calculateMetrics)', () => {
        it('is false with fewer than 100 observations', () => {
            const gt = new GroundTruthCollector();
            for (let i = 0; i < 60; i++) gt.record('x', prediction({ successProbability: 0.9 }), actual(0.9));
            expect(gt.calculateMetrics().driftDetected).toBe(false);
        });

        it('detects drift when recent error is markedly higher than historical', () => {
            const gt = new GroundTruthCollector();
            // First 50 (historical): low error ~0.0
            for (let i = 0; i < 50; i++) gt.record('x', prediction({ successProbability: 0.9 }), actual(0.9));
            // Last 50 (recent): high error ~0.8
            for (let i = 0; i < 50; i++) gt.record('x', prediction({ successProbability: 0.9 }), actual(0.1));
            expect(gt.calculateMetrics().driftDetected).toBe(true);
        });
    });

    describe('exportForTraining & clear', () => {
        it('exports feature/outcome tuples and clears entries', () => {
            const gt = new GroundTruthCollector();
            gt.record('a', prediction({ successProbability: 0.9 }), actual(0.9));
            const exported = gt.exportForTraining();
            expect(exported).toHaveLength(1);
            expect(exported[0]).toMatchObject({ actualOutcome: true, predictionWas: 0.9 });
            expect(exported[0].features.predictedSuccess).toBe(0.9);

            gt.clear();
            expect(gt.getSummary().totalObservations).toBe(0);
        });
    });

    describe('heuristic distillation trigger', () => {
        beforeEach(() => vi.stubEnv('ENABLE_HEURISTIC_DISTILLATION', 'true'));
        afterEach(() => vi.unstubAllEnvs());
        it('does not distill reliable blueprints when opt-in is disabled', async () => {
            vi.stubEnv('ENABLE_HEURISTIC_DISTILLATION', 'false');
            distillMock.mockClear();
            const gt = new GroundTruthCollector();
            for (let i = 0; i < 60; i++) gt.record('c', prediction(), actual(0.99), 'disabled-bp');
            await new Promise(r => setTimeout(r, 10));
            expect(distillMock).not.toHaveBeenCalled();
        });
        it('triggers distillation once for a highly reliable blueprint, respecting cooldown', async () => {
            distillMock.mockClear();
            const gt = new GroundTruthCollector();

            // 50 near-perfect runs for the same blueprint -> avg >= 0.98 on the 50th.
            for (let i = 0; i < 50; i++) {
                gt.record('c', prediction(), actual(0.99), 'reliable-bp');
            }

            await vi.waitFor(() => expect(distillMock).toHaveBeenCalledWith('reliable-bp'));

            // Another qualifying record within the 24h cooldown must NOT re-trigger.
            gt.record('c', prediction(), actual(0.99), 'reliable-bp');
            await new Promise(r => setTimeout(r, 10));
            expect(distillMock).toHaveBeenCalledTimes(1);
        });

        it('does not trigger for blueprints below the reliability threshold', async () => {
            distillMock.mockClear();
            const gt = new GroundTruthCollector();
            for (let i = 0; i < 60; i++) gt.record('c', prediction(), actual(0.8), 'mediocre-bp');
            await new Promise(r => setTimeout(r, 10));
            expect(distillMock).not.toHaveBeenCalled();
        });
    });
});
