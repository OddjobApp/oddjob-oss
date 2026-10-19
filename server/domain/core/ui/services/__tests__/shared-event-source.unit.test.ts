import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BroadcastChannel as NodeBroadcastChannel } from 'node:worker_threads';

class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  closed = false;
  named = new Map<string, (e: MessageEvent) => void>();

  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: (e: MessageEvent) => void) {
    this.named.set(name, listener);
  }

  sendNamed(name: string, data: unknown, lastEventId = '') {
    this.named.get(name)?.({ data: JSON.stringify(data), lastEventId } as MessageEvent);
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  send(data: unknown, lastEventId = '') {
    this.onmessage?.({ data: JSON.stringify(data), lastEventId } as MessageEvent);
  }

  fail() {
    this.readyState = 2;
    this.onerror?.();
  }

  static live() {
    return MockEventSource.instances.filter((es) => !es.closed);
  }
}

/** A minimal exclusive Web Locks manager shared by every simulated tab. */
function makeLockManager() {
  const held = new Set<string>();
  const waiting = new Map<string, Array<() => void>>();
  return {
    request(name: string, callback: () => Promise<void>) {
      return new Promise<void>((resolve, reject) => {
        const run = () => {
          held.add(name);
          Promise.resolve(callback()).then(() => {
            held.delete(name);
            resolve();
            waiting.get(name)?.shift()?.();
          }, reject);
        };
        if (held.has(name)) {
          const queue = waiting.get(name) ?? [];
          queue.push(run);
          waiting.set(name, queue);
        } else {
          run();
        }
      });
    },
  };
}

type SharedModule = typeof import('../shared-event-source');

/** Each import after resetModules is a separate module instance: a separate tab. */
async function openTab(): Promise<SharedModule> {
  vi.resetModules();
  return import('../shared-event-source');
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('shared-event-source within one tab', () => {
  let shared: SharedModule;

  beforeEach(async () => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('BroadcastChannel', undefined);
    shared = await openTab();
  });

  afterEach(() => {
    shared.__resetSharedStreams();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('opens one connection for any number of subscribers to a URL', () => {
    const a = vi.fn();
    const b = vi.fn();
    shared.subscribeSharedStream('/api/events/stream', a);
    shared.subscribeSharedStream('/api/events/stream', b);

    expect(MockEventSource.instances).toHaveLength(1);
    MockEventSource.instances[0].send({ eventId: '1' });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('keeps separate connections for separate URLs (orgs)', () => {
    shared.subscribeSharedStream('/api/events/stream?organizationId=1', vi.fn());
    shared.subscribeSharedStream('/api/events/stream?organizationId=2', vi.fn());
    expect(MockEventSource.instances.map((es) => es.url)).toEqual([
      '/api/events/stream?organizationId=1',
      '/api/events/stream?organizationId=2',
    ]);
  });

  it('closes after the last subscriber leaves, not before', async () => {
    const offA = shared.subscribeSharedStream('/s', vi.fn());
    const offB = shared.subscribeSharedStream('/s', vi.fn());

    offA();
    await flush();
    expect(MockEventSource.instances[0].closed).toBe(false);

    offB();
    await flush();
    expect(MockEventSource.instances[0].closed).toBe(true);
  });

  it('keeps the connection across an unsubscribe and resubscribe in the same tick', async () => {
    const off = shared.subscribeSharedStream('/s', vi.fn());
    off();
    shared.subscribeSharedStream('/s', vi.fn());
    await flush();

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].closed).toBe(false);
  });

  it('replays what the tab already received to a late subscriber', () => {
    shared.subscribeSharedStream('/s', vi.fn());
    MockEventSource.instances[0].send({ eventId: 'early' });

    const late = vi.fn();
    shared.subscribeSharedStream('/s', late);
    expect(late).toHaveBeenCalledWith(expect.objectContaining({ data: JSON.stringify({ eventId: 'early' }) }));
  });

  it('does not replay to a late subscriber when the stream opts out', () => {
    shared.subscribeSharedStream('/room', vi.fn(), undefined, { events: ['turn'], replay: false });
    MockEventSource.instances[0].sendNamed('turn', { id: 1 });

    const late = vi.fn();
    shared.subscribeSharedStream('/room', late);
    expect(late).not.toHaveBeenCalled();

    MockEventSource.instances[0].sendNamed('turn', { id: 2 });
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('keeps delivering to other subscribers when one throws', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();
    shared.subscribeSharedStream('/s', () => { throw new Error('boom'); });
    shared.subscribeSharedStream('/s', good);

    MockEventSource.instances[0].send({ eventId: '1' });
    expect(good).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });

  it('relays the named events a stream declares, tagged with their name', () => {
    const got = vi.fn();
    shared.subscribeSharedStream('/d', got, undefined, { events: ['decision:new'] });
    MockEventSource.instances[0].sendNamed('decision:new', { id: 1 }, 'e1');
    MockEventSource.instances[0].sendNamed('decision:other', { id: 2 });

    expect(got).toHaveBeenCalledTimes(1);
    expect(got).toHaveBeenCalledWith({ event: 'decision:new', data: JSON.stringify({ id: 1 }), lastEventId: 'e1' });
  });

  it('resumes from the last event id when it has to reopen the stream', () => {
    vi.useFakeTimers();
    shared.subscribeSharedStream('/d?organizationId=4', vi.fn(), undefined, { events: ['decision:new'], resumeParam: 'lastEventId' });
    expect(MockEventSource.instances[0].url).toBe('/d?organizationId=4');

    MockEventSource.instances[0].sendNamed('decision:new', {}, 'id 7');
    MockEventSource.instances[0].fail();
    vi.advanceTimersByTime(1000);

    expect(MockEventSource.live()[0].url).toBe('/d?organizationId=4&lastEventId=id%207');
  });

  it('reports state and reconnects with backoff once the browser gives up', () => {
    vi.useFakeTimers();
    const states: string[] = [];
    shared.subscribeSharedStream('/s', vi.fn(), (s) => states.push(s));

    MockEventSource.instances[0].open();
    MockEventSource.instances[0].fail();
    expect(states).toEqual(['connecting', 'open', 'closed']);
    expect(MockEventSource.live()).toHaveLength(0);

    vi.advanceTimersByTime(1000);
    expect(MockEventSource.live()).toHaveLength(1);

    // Consecutive failures back off: 2s after the second.
    MockEventSource.live()[0].fail();
    vi.advanceTimersByTime(1999);
    expect(MockEventSource.live()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(MockEventSource.live()).toHaveLength(1);
  });
});

describe('shared-event-source across tabs', () => {
  const tabs: SharedModule[] = [];

  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('BroadcastChannel', NodeBroadcastChannel);
    Object.defineProperty(navigator, 'locks', { value: makeLockManager(), configurable: true });
  });

  afterEach(() => {
    for (const tab of tabs.splice(0)) tab.__resetSharedStreams();
    vi.unstubAllGlobals();
    delete (navigator as any).locks;
  });

  it('opens one connection for the whole browser and relays it to other tabs', async () => {
    const tabA = await openTab();
    const tabB = await openTab();
    tabs.push(tabA, tabB);

    const inA = vi.fn();
    const inB = vi.fn();
    tabA.subscribeSharedStream('/s', inA);
    await flush();
    tabB.subscribeSharedStream('/s', inB);
    await flush();

    expect(MockEventSource.instances).toHaveLength(1);

    MockEventSource.instances[0].send({ eventId: 'shared' });
    await flush();
    expect(inA).toHaveBeenCalledTimes(1);
    expect(inB).toHaveBeenCalledTimes(1);
  });

  it('catches a late tab up on what the leader already received', async () => {
    const tabA = await openTab();
    tabs.push(tabA);
    tabA.subscribeSharedStream('/s', vi.fn());
    await flush();
    MockEventSource.instances[0].send({ eventId: 'before-b' });

    const tabB = await openTab();
    tabs.push(tabB);
    const inB = vi.fn();
    tabB.subscribeSharedStream('/s', inB);
    await flush();

    expect(inB).toHaveBeenCalledWith(expect.objectContaining({ data: JSON.stringify({ eventId: 'before-b' }) }));
  });

  it('hands the connection to a waiting tab when the leader leaves', async () => {
    const tabA = await openTab();
    const tabB = await openTab();
    tabs.push(tabA, tabB);

    const offA = tabA.subscribeSharedStream('/s', vi.fn());
    await flush();
    const inB = vi.fn();
    tabB.subscribeSharedStream('/s', inB);
    await flush();

    offA();
    await flush();

    expect(MockEventSource.instances[0].closed).toBe(true);
    expect(MockEventSource.live()).toHaveLength(1);

    MockEventSource.live()[0].send({ eventId: 'after-handover' });
    await flush();
    expect(inB).toHaveBeenCalledWith(expect.objectContaining({ data: JSON.stringify({ eventId: 'after-handover' }) }));
  });

  it('resumes from the last relayed event id when a waiting tab takes over', async () => {
    const tabA = await openTab();
    const tabB = await openTab();
    tabs.push(tabA, tabB);
    const options = { events: ['decision:new'], resumeParam: 'lastEventId' };

    const offA = tabA.subscribeSharedStream('/d', vi.fn(), undefined, options);
    await flush();
    tabB.subscribeSharedStream('/d', vi.fn(), undefined, options);
    await flush();
    MockEventSource.instances[0].sendNamed('decision:new', {}, 'e42');
    await flush();

    offA();
    await flush();

    expect(MockEventSource.live()[0].url).toBe('/d?lastEventId=e42');
  });

  it('does not hand a late tab the backlog when the stream opts out', async () => {
    const options = { events: ['turn'], replay: false };
    const tabA = await openTab();
    tabs.push(tabA);
    tabA.subscribeSharedStream('/room', vi.fn(), undefined, options);
    await flush();
    MockEventSource.instances[0].sendNamed('turn', { id: 1 });

    const tabB = await openTab();
    tabs.push(tabB);
    const inB = vi.fn();
    const states: string[] = [];
    tabB.subscribeSharedStream('/room', inB, (s) => states.push(s), options);
    MockEventSource.instances[0].open();
    await flush();

    expect(inB).not.toHaveBeenCalled();
    expect(states).toContain('open');
  });
});
