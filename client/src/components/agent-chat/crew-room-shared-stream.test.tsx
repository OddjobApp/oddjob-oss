/**
 * A crew room's live stream goes through the shared stream: the same room
 * mounted twice (two panels, or two tabs) holds one connection, and a frame
 * reaches both. Separate rooms keep separate streams, because each room's
 * stream is authorized separately (private project rooms).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queryClient')>()),
  apiRequest: vi.fn(),
}));

type Listener = (event: MessageEvent) => void;

class EventSourceStub {
  static instances: EventSourceStub[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: Listener | null = null;
  closed = false;
  listeners = new Map<string, Listener[]>();
  constructor(public url: string) {
    EventSourceStub.instances.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener() {}
  close() {
    this.closed = true;
  }
  emit(type: string, payload: Record<string, unknown>) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify({ type, payload }) } as MessageEvent);
  }
}

import { apiRequest } from '@/lib/queryClient';
import { useCrewSession } from './useCrewSession';
import { __resetSharedStreams } from '@domain-ui/core/ui/services/shared-event-source';

const roomReads = (key: string) =>
  (apiRequest as any).mock.calls.filter(([, url]: [string, string]) => url.startsWith(`/api/crew/${key}`)).length;

beforeEach(() => {
  EventSourceStub.instances = [];
  vi.stubGlobal('EventSource', EventSourceStub);
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.clearAllMocks();
  (apiRequest as any).mockImplementation(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ turns: [], notes: [], plans: [], issues: [], members: [], session: null }),
    }),
  );
});

afterEach(() => {
  __resetSharedStreams();
  vi.unstubAllGlobals();
});

describe('crew room stream', () => {
  it('holds one connection for a room mounted twice, and both receive its frames', async () => {
    const a = renderHook(() => useCrewSession({ roomKey: 'room-a' }));
    const b = renderHook(() => useCrewSession({ roomKey: 'room-a' }));
    await waitFor(() => expect(EventSourceStub.instances).toHaveLength(1));

    const before = roomReads('room-a');
    EventSourceStub.instances[0].emit('participant', {});
    // Each mounted hook reconciles its own copy of the room.
    await waitFor(() => expect(roomReads('room-a')).toBe(before + 2));

    a.unmount();
    b.unmount();
  });

  it('keeps separate streams for separate rooms', async () => {
    renderHook(() => useCrewSession({ roomKey: 'room-a' }));
    renderHook(() => useCrewSession({ roomKey: 'room-b' }));
    await waitFor(() => expect(EventSourceStub.instances).toHaveLength(2));
    expect(EventSourceStub.instances.map((es) => es.url).sort()).toEqual([
      '/api/crew/room-a/stream',
      '/api/crew/room-b/stream',
    ]);
  });

  it('closes the room stream when the last panel on it unmounts', async () => {
    const a = renderHook(() => useCrewSession({ roomKey: 'room-a' }));
    const b = renderHook(() => useCrewSession({ roomKey: 'room-a' }));
    await waitFor(() => expect(EventSourceStub.instances).toHaveLength(1));

    a.unmount();
    await Promise.resolve();
    expect(EventSourceStub.instances[0].closed).toBe(false);

    b.unmount();
    await waitFor(() => expect(EventSourceStub.instances[0].closed).toBe(true));
  });

  it('reports a lost connection once an open stream drops, and clears it on reopen', async () => {
    const { result } = renderHook(() => useCrewSession({ roomKey: 'room-a' }));
    await waitFor(() => expect(EventSourceStub.instances).toHaveLength(1));
    const es = EventSourceStub.instances[0];

    es.readyState = 1;
    es.onopen?.();
    await waitFor(() => expect(result.current.connectionLost).toBe(false));
    await new Promise((r) => setTimeout(r, 50));
    // The first open does not refetch: the room was just loaded.
    expect(roomReads('room-a')).toBe(0);

    es.readyState = 0;
    es.onerror?.();
    await waitFor(() => expect(result.current.connectionLost).toBe(true));

    es.readyState = 1;
    es.onopen?.();
    await waitFor(() => expect(result.current.connectionLost).toBe(false));
    // A reopened stream may have missed frames, so it reconciles.
    await waitFor(() => expect(roomReads('room-a')).toBeGreaterThan(0));
  });
});
