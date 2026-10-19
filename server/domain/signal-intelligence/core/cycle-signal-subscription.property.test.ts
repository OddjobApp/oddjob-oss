/**
 * Delivery-mode filtering and matching.
 *
 * The filter decides whether a signal disturbs a cycle at all, so both
 * directions cost something real: too permissive and every signal re-queues
 * running missions, too strict and a Critical event never reaches the cycle
 * subscribed to it.
 *
 * The orchestrator pulls in the database at import time, so the two pure
 * predicates are exercised through a stubbed connection.
 */

import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('@server/database_service.js', () => ({ db: {} }));
vi.mock('@domain/mission/infrastructure/dynamic-mission-queue.js', () => ({ queueMissionCycle: vi.fn() }));
vi.mock('@domain/core/infrastructure/event-stream.service.js', () => ({ eventStream: { publish: vi.fn() } }));

const { CycleSignalSubscriptionService } = await import('./cycle-signal-subscription.service.js');

const service = new CycleSignalSubscriptionService() as any;

const subscription = (over: Record<string, unknown> = {}) => ({
  id: 1, organizationId: 7, cycleId: 1, name: 's', enabled: true,
  filters: {}, deliveryMode: 'context_only', stateProjection: {},
  cooldownMinutes: 0, lastDeliveredAt: null,
  ...over,
}) as any;

const event = (over: Record<string, unknown> = {}) => ({
  id: 'e1', organizationId: 7, eventType: 'policy_change', targetSector: 'Energy',
  jurisdiction: 'US', severity: 'High', confidenceScore: 0.9,
  ...over,
}) as any;

const link = (targetEntityId: string) => ({ targetEntityId, blastRadius: 1 }) as any;

describe('subscription matching', () => {
  it('passes a signal through an empty filter', () => {
    expect(service.matches(subscription(), event(), [])).toBe(true);
  });

  it.each([
    ['eventTypes', { eventTypes: ['other_type'] }],
    ['sectors', { sectors: ['Semiconductor'] }],
    ['jurisdictions', { jurisdictions: ['EU'] }],
  ])('rejects on a mismatched %s filter', (_label, filters) => {
    expect(service.matches(subscription({ filters }), event(), [])).toBe(false);
  });

  it('treats minimumSeverity as a floor, not an equality', () => {
    const filters = { minimumSeverity: 'High' };
    expect(service.matches(subscription({ filters }), event({ severity: 'Critical' }), [])).toBe(true);
    expect(service.matches(subscription({ filters }), event({ severity: 'High' }), [])).toBe(true);
    expect(service.matches(subscription({ filters }), event({ severity: 'Medium' }), [])).toBe(false);
  });

  it('treats minimumConfidence as a floor', () => {
    const filters = { minimumConfidence: 0.8 };
    expect(service.matches(subscription({ filters }), event({ confidenceScore: 0.8 }), [])).toBe(true);
    expect(service.matches(subscription({ filters }), event({ confidenceScore: 0.79 }), [])).toBe(false);
  });

  it('matches an entity filter against the causal links, not the event', () => {
    const filters = { entityIds: ['asset-2'] };
    expect(service.matches(subscription({ filters }), event(), [link('asset-1'), link('asset-2')])).toBe(true);
    expect(service.matches(subscription({ filters }), event(), [link('asset-1')])).toBe(false);
  });

  it('requires EVERY configured filter to pass', () => {
    // One satisfied filter must not carry a signal past a failing one.
    const filters = { sectors: ['Energy'], jurisdictions: ['EU'] };
    expect(service.matches(subscription({ filters }), event(), [])).toBe(false);
  });

  it('never rejects on a filter key that was not configured', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('Low', 'Medium', 'High', 'Critical'),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.string({ maxLength: 12 }),
        (severity, confidenceScore, sector) => {
          expect(
            service.matches(subscription({ filters: {} }), event({ severity, confidenceScore, targetSector: sector }), []),
          ).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});

/**
 * Cooldown is covered by
 * `server/domain/signal-intelligence/tests/integration/cycle-signal-cooldown.test.ts`.
 *
 * The property tests that lived here asserted the old contract — a synchronous
 * `inCooldown(subscription)` keyed on `subscription.lastDeliveredAt`. That
 * behaviour was a fleet-wide mute (one vessel silenced every other on the same
 * subscription), and the fix made cooldown per-subject, async, and backed by
 * `cycle_signal_deliveries` joined to `event_primitives`. None of that is
 * reachable without a database, so the tests could not be repaired in place and
 * were failing rather than protecting anything.
 */

const { SURPRISE_FLOOR } = await import('./cycle-signal-subscription.service.js');

/**
 * A surprise escalates the configured mode to a floor, never below it. The two
 * failure directions are both real: too low and a `context_only` subscription
 * silently swallows the news that a prediction was wrong; too high and a
 * surprise overrides an operator who deliberately asked for a gate.
 */
describe('surprise escalation floor', () => {
  const STRENGTH: Record<string, number> = {
    context_only: 0, notify: 1, replan: 2, trigger: 3, gate: 4,
  };

  it('lifts the modes that would otherwise ignore prediction error', () => {
    expect(SURPRISE_FLOOR.context_only).toBe('replan');
    expect(SURPRISE_FLOOR.notify).toBe('replan');
  });

  it('preserves a stronger configured choice rather than flattening it', () => {
    expect(SURPRISE_FLOOR.trigger).toBe('trigger');
    expect(SURPRISE_FLOOR.gate).toBe('gate');
  });

  it('never returns a mode weaker than the configured one', () => {
    for (const [configured, escalated] of Object.entries(SURPRISE_FLOOR)) {
      expect(STRENGTH[escalated]).toBeGreaterThanOrEqual(STRENGTH[configured]);
    }
  });

  it('never returns a mode below the replan floor', () => {
    for (const escalated of Object.values(SURPRISE_FLOOR)) {
      expect(STRENGTH[escalated]).toBeGreaterThanOrEqual(STRENGTH.replan);
    }
  });

  it('covers every mode the API accepts, so none falls through to a default', () => {
    // These are validated on write in signal-intelligence.routes.ts; a mode
    // missing here would silently take the `?? "replan"` fallback.
    for (const mode of ['context_only', 'replan', 'trigger', 'gate', 'notify']) {
      expect(SURPRISE_FLOOR[mode]).toBeDefined();
    }
  });
});
