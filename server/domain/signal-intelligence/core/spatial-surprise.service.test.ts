/**
 * Prediction error.
 *
 * `computeSurprise` is the judgement that decides whether an agent should
 * replan, so the properties that matter are about what it stays QUIET for. A
 * surprise detector that fires on everything is indistinguishable from no
 * detector at all — it just moves the filtering downstream.
 *
 * Pure function, so no broker and no database: the threshold will be tuned, and
 * tuning it should not need either.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { computeSurprise, surpriseEventId, type PredictionSide, type ObservationSide } from './spatial-surprise.service.js';

const prediction = (blastRadius: number): PredictionSide => ({ eventId: 'p1', blastRadius });
const observation = (over: Partial<ObservationSide> = {}): ObservationSide => ({
  eventId: 'o1',
  outcome: 'succeeded',
  ...over,
});

describe('computeSurprise — outcome polarity', () => {
  it.each(['failed', 'cancelled'] as const)('reports an action that %s as categorically wrong', outcome => {
    const result = computeSurprise(prediction(10), observation({ outcome }));

    expect(result).not.toBeNull();
    expect(result!.dimension).toBe('outcome');
    expect(result!.error).toBe(1);
    expect(result!.observed).toBe(outcome);
  });

  it('stays quiet when the action succeeded and no magnitude was reported', () => {
    expect(computeSurprise(prediction(10), observation())).toBeNull();
  });

  it('lets polarity dominate a magnitude that would otherwise be close', () => {
    // A near-perfect blast radius on an action that did not happen is noise, not
    // reassurance — the categorical failure is the thing worth reporting.
    const result = computeSurprise(
      prediction(10),
      observation({ outcome: 'failed', metrics: { blastRadius: 10 } }),
    );

    expect(result!.dimension).toBe('outcome');
  });
});

describe('computeSurprise — magnitude', () => {
  it('reports a divergence past the threshold', () => {
    const result = computeSurprise(prediction(10), observation({ metrics: { blastRadius: 40 } }), 0.25);

    expect(result).not.toBeNull();
    expect(result!.dimension).toBe('blastRadius');
    expect(result!.predicted).toBe(10);
    expect(result!.observed).toBe(40);
  });

  it('stays quiet within the threshold', () => {
    // 10 vs 12 is a 0.167 error against a scale of 12 — below 0.25.
    expect(computeSurprise(prediction(10), observation({ metrics: { blastRadius: 12 } }), 0.25)).toBeNull();
  });

  it('scores an under- and over-prediction of the same ratio alike', () => {
    const under = computeSurprise(prediction(10), observation({ metrics: { blastRadius: 100 } }), 0.1);
    const over = computeSurprise(prediction(100), observation({ metrics: { blastRadius: 10 } }), 0.1);

    expect(under!.error).toBeCloseTo(over!.error, 10);
  });

  it('survives a predicted zero without dividing by it', () => {
    const result = computeSurprise(prediction(0), observation({ metrics: { blastRadius: 5 } }), 0.25);

    expect(Number.isFinite(result!.error)).toBe(true);
    expect(result!.error).toBeLessThanOrEqual(1);
  });

  it('ignores a non-finite reported magnitude rather than scoring it', () => {
    expect(computeSurprise(prediction(10), observation({ metrics: { blastRadius: NaN } }))).toBeNull();
    expect(computeSurprise(prediction(10), observation({ metrics: { blastRadius: Infinity } }))).toBeNull();
  });
});

describe('computeSurprise — properties', () => {
  const finiteRadius = fc.integer({ min: 0, max: 10_000 });

  it('always reports an error within 0..1, whatever the inputs', () => {
    fc.assert(
      fc.property(
        finiteRadius,
        finiteRadius,
        fc.constantFrom<ObservationSide['outcome']>('succeeded', 'failed', 'cancelled'),
        fc.double({ min: 0.01, max: 1, noNaN: true }),
        (predicted, observed, outcome, threshold) => {
          const result = computeSurprise(
            prediction(predicted),
            observation({ outcome, metrics: { blastRadius: observed } }),
            threshold,
          );

          // The payload schema constrains error to 0..1; a value outside that
          // range would be rejected at publish time rather than here.
          if (result) {
            expect(result.error).toBeGreaterThanOrEqual(0);
            expect(result.error).toBeLessThanOrEqual(1);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('never reports a successful action whose magnitude matched exactly', () => {
    fc.assert(
      fc.property(finiteRadius, radius => {
        expect(
          computeSurprise(prediction(radius), observation({ metrics: { blastRadius: radius } })),
        ).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  it('reports every failed action regardless of magnitude', () => {
    fc.assert(
      fc.property(finiteRadius, finiteRadius, (predicted, observed) => {
        const result = computeSurprise(
          prediction(predicted),
          observation({ outcome: 'failed', metrics: { blastRadius: observed } }),
        );
        expect(result?.dimension).toBe('outcome');
      }),
      { numRuns: 200 },
    );
  });

  it('is monotonic: a larger divergence never scores lower', () => {
    fc.assert(
      fc.property(finiteRadius, finiteRadius, finiteRadius, (predicted, a, b) => {
        const [near, far] = Math.abs(predicted - a) <= Math.abs(predicted - b) ? [a, b] : [b, a];
        const nearResult = computeSurprise(prediction(predicted), observation({ metrics: { blastRadius: near } }), 0.001);
        const farResult = computeSurprise(prediction(predicted), observation({ metrics: { blastRadius: far } }), 0.001);

        // Both use the same scale only when the larger side is the same, so this
        // compares the raw divergence rather than the normalised score.
        if (nearResult && farResult && Math.max(predicted, near, 1) === Math.max(predicted, far, 1)) {
          expect(farResult.error).toBeGreaterThanOrEqual(nearResult.error);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('surpriseEventId', () => {
  it('is stable for the same observation, so two callers cannot double-publish', () => {
    // The Kafka consumer and the in-process path both evaluate the same outcome.
    // A random id would enqueue two surprise events for one divergence; a derived
    // one collides with the outbox's unique event_id and the second is a no-op.
    expect(surpriseEventId('obs-1')).toBe(surpriseEventId('obs-1'));
  });

  it('differs per observation', () => {
    expect(surpriseEventId('obs-1')).not.toBe(surpriseEventId('obs-2'));
  });

  it('is a well-formed uuid, which the envelope requires', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 60 }), id => {
        expect(surpriseEventId(id)).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
      }),
      { numRuns: 200 },
    );
  });
});

describe('the surprise event the id is used on', () => {
  it('passes the real envelope validator, not just a regex of my own', async () => {
    // If this id shape were wrong, every surprise event would be rejected at
    // publish time — so it is checked against the contract that actually gates it.
    const { parseSpatialEvent, SPATIAL_EVENT_TOPICS } = await import('@shared/contracts/spatial-events.js');

    expect(() => parseSpatialEvent({
      eventId: surpriseEventId('observation-abc'),
      eventType: SPATIAL_EVENT_TOPICS.assessment,
      type: 'surprise',
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      organizationId: 7,
      producer: 'signal-intelligence',
      correlationId: 'corr-1',
      confidenceScore: 1,
      payload: {
        predictionEventId: 'p', observationEventId: 'observation-abc',
        dimension: 'outcome', predicted: 'succeeded', observed: 'failed',
        error: 1, threshold: 0.25,
      },
    })).not.toThrow();
  });
});
