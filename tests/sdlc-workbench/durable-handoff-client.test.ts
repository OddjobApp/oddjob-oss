import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handoffs } from '../../server/blueprints/apps/sdlc-workbench/lib/platform-client';
const fetcher = vi.fn();
const input = { version: 1 as const, transition: 'qa_to_uat' as const, sourceRecordId: 'gate-1', sourceUpdatedAt: '2026-10-14T12:00:00.000Z', commitSha: 'a'.repeat(40), ticketKeys: [] };
describe('durable handoff client reconciliation', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/app/sdlc-test/qa-workbench?crewRoom=room-a&orgId=342');
    window.localStorage.clear(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher);
  });
  afterEach(() => vi.unstubAllGlobals());
  it('keeps an unknown offer for retry without ever repeating a mission trigger', async () => {
    fetcher.mockRejectedValueOnce(new Error('Connection closed after request'));
    await expect(handoffs.offer(input)).rejects.toThrow('do not repeat the source action');
    expect(handoffs.pending()).toEqual([input]);
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ handoff: { id: 'durable-receipt' }, replayed: true, blocker: null }) });
    await handoffs.offer(input);
    expect(handoffs.pending()).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(call => call[0] === '/api/oddjob/handoffs?crewRoom=room-a')).toBe(true);
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
  });
  it('isolates pending offers by app, organization and room across navigation', async () => {
    fetcher.mockRejectedValue(new Error('Offline'));
    await expect(handoffs.offer(input)).rejects.toThrow();
    window.history.replaceState({}, '', '/app/sdlc-test/qa-workbench?crewRoom=room-b&orgId=342');
    expect(handoffs.pending()).toEqual([]);
    window.history.replaceState({}, '', '/app/other/qa-workbench?crewRoom=room-a&orgId=342');
    expect(handoffs.pending()).toEqual([]);
    window.history.replaceState({}, '', '/app/sdlc-test/qa-workbench?crewRoom=room-a&orgId=473');
    expect(handoffs.pending()).toEqual([]);
    window.history.replaceState({}, '', '/app/sdlc-test/qa-workbench?crewRoom=room-a&orgId=342');
    expect(handoffs.pending()).toEqual([input]);
  });
  it('does not make an unbound standalone handoff request', async () => {
    window.history.replaceState({}, '', '/app/sdlc-test/qa-workbench');
    await expect(handoffs.offer(input)).rejects.toThrow('configured CREW room');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
