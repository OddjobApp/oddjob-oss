import { describe, expect, it } from 'vitest';
import { compileEventTypeFilter, isEventVisibleTo } from '../event-visibility';

const member = { userId: 'u1', organizationId: 1 };

describe('isEventVisibleTo', () => {
  it("hides another organization's events", () => {
    expect(isEventVisibleTo({ eventType: 'intervention.triggered', context: { organizationId: 2 } }, member)).toBe(false);
  });

  it("shows the viewer's own organization's events", () => {
    expect(isEventVisibleTo({ eventType: 'FORGE_LOG', context: { organizationId: 1 } }, member)).toBe(true);
  });

  it('compares org ids by value, not type', () => {
    expect(isEventVisibleTo({ context: { organizationId: '1' } }, member)).toBe(true);
  });

  it('shows untagged (system-wide) events to everyone', () => {
    expect(isEventVisibleTo({ eventType: 'deployment.completed' }, member)).toBe(true);
    expect(isEventVisibleTo({ context: { organizationId: null } }, member)).toBe(true);
  });

  it('hides org-tagged events from a viewer with no org', () => {
    expect(isEventVisibleTo({ context: { organizationId: 1 } }, { userId: 'u1', organizationId: null })).toBe(false);
  });

  it('sends psychologist intent events only to the user they were inferred for', () => {
    const intent = { source: 'psychologist', eventType: 'INTENT_STABILIZED', payload: { user_id: 'u1' } };
    expect(isEventVisibleTo(intent, member)).toBe(true);
    expect(isEventVisibleTo(intent, { userId: 'u2', organizationId: 1 })).toBe(false);
    expect(isEventVisibleTo({ ...intent, payload: {} }, member)).toBe(false);
  });
});

describe('compileEventTypeFilter', () => {
  it('returns null for no filter', () => {
    expect(compileEventTypeFilter(undefined)).toBeNull();
    expect(compileEventTypeFilter('all')).toBeNull();
  });

  it('matches * as one segment, ** as any, and comma lists', () => {
    const f = compileEventTypeFilter('signal.*,mission.**')!;
    expect(f('signal.created')).toBe(true);
    expect(f('signal.a.b')).toBe(false);
    expect(f('mission.step.done')).toBe(true);
    expect(f('missionx')).toBe(false);
  });
});
