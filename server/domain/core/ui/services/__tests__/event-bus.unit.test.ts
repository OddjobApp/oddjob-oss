import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetEventBusOrg, compileTypeMatcher, eventStreamUrl, setEventStreamOrg, subscribeEvents } from '../event-bus';
import { __resetSharedStreams } from '../shared-event-source';

class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }
  close() {}
  send(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data), lastEventId: '' } as MessageEvent);
  }
}

describe('compileTypeMatcher', () => {
  it('matches one segment with * and any depth with **', () => {
    const one = compileTypeMatcher('mission.*');
    expect(one('mission.completed')).toBe(true);
    expect(one('mission.step.completed')).toBe(false);

    const any = compileTypeMatcher('signal.**');
    expect(any('signal.event_primitive.created')).toBe(true);
    expect(any('signals.x')).toBe(false);
  });

  it('accepts lists and comma-separated strings, and treats no filter as everything', () => {
    expect(compileTypeMatcher(['a.b', 'c.*'])('c.d')).toBe(true);
    expect(compileTypeMatcher('a.b, c.d')('c.d')).toBe(true);
    expect(compileTypeMatcher(undefined)('anything')).toBe(true);
  });

  it('treats regex metacharacters in a type literally', () => {
    expect(compileTypeMatcher('selenium-run:1+2')('selenium-run:1+2')).toBe(true);
    expect(compileTypeMatcher('selenium-run:1+2')('selenium-run:112')).toBe(false);
  });
});

describe('subscribeEvents', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('BroadcastChannel', undefined);
    sessionStorage.clear();
  });

  afterEach(() => {
    __resetSharedStreams();
    __resetEventBusOrg();
    vi.unstubAllGlobals();
  });

  it('moves live subscriptions to the new org stream and closes the old one', async () => {
    sessionStorage.setItem('selectedOrganizationId', '291');
    const seen = vi.fn();
    subscribeEvents({ type: 'mission.*' }, seen);
    subscribeEvents({}, vi.fn());
    expect(MockEventSource.instances.map((es) => es.url)).toEqual(['/api/events/stream?organizationId=291']);
    const closeOld = vi.spyOn(MockEventSource.instances[0], 'close');

    setEventStreamOrg(473);
    await new Promise((r) => setTimeout(r, 0));

    // Both subscribers moved to one new stream; the old one closed.
    expect(MockEventSource.instances.map((es) => es.url)).toEqual([
      '/api/events/stream?organizationId=291',
      '/api/events/stream?organizationId=473',
    ]);
    expect(closeOld).toHaveBeenCalled();

    MockEventSource.instances[1].send({ eventId: 'n', eventType: 'mission.completed', source: 's', payload: {} });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('subscribes new mounts to the reported org, not stale sessionStorage', () => {
    sessionStorage.setItem('selectedOrganizationId', '291');
    setEventStreamOrg(473);
    subscribeEvents({}, vi.fn());
    expect(MockEventSource.instances[0].url).toBe('/api/events/stream?organizationId=473');
  });

  it('scopes the stream URL to the active org', () => {
    expect(eventStreamUrl()).toBe('/api/events/stream');
    sessionStorage.setItem('selectedOrganizationId', '7');
    expect(eventStreamUrl()).toBe('/api/events/stream?organizationId=7');
  });

  it('filters by type and source and shares one connection', () => {
    const missions = vi.fn();
    const forge = vi.fn();
    subscribeEvents({ type: 'mission.*' }, missions);
    subscribeEvents({ type: 'FORGE_LOG', source: 'app-forge' }, forge);
    expect(MockEventSource.instances).toHaveLength(1);

    const es = MockEventSource.instances[0];
    es.send({ eventId: '1', eventType: 'mission.completed', source: 'mission', payload: {} });
    es.send({ eventId: '2', eventType: 'FORGE_LOG', source: 'other', payload: {} });
    es.send({ eventId: '3', eventType: 'FORGE_LOG', source: 'app-forge', payload: { jobId: 'j' } });

    expect(missions).toHaveBeenCalledTimes(1);
    expect(forge).toHaveBeenCalledTimes(1);
    expect(forge.mock.calls[0][0].payload).toEqual({ jobId: 'j' });
  });

  it('delivers an event once even when a reconnect replays it', () => {
    const seen = vi.fn();
    subscribeEvents({}, seen);
    const es = MockEventSource.instances[0];
    const event = { eventId: 'dup', eventType: 'x.y', source: 's', payload: {} };
    es.send(event);
    es.send(event);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed frames', () => {
    const seen = vi.fn();
    subscribeEvents({}, seen);
    MockEventSource.instances[0].send('not json');
    MockEventSource.instances[0].send({ no: 'eventType' });
    expect(seen).not.toHaveBeenCalled();
  });
});
