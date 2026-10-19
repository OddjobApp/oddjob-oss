import { describe, it, expect } from 'vitest';
import { readCrewAppActivity, mergeCrewAppActivity } from './crew-app-activity';
const event = { id: '1', timestamp: '2026-10-13T10:00:00Z', type: 'tool_result', agentName: 'QA', summary: 'Test run failed' };
describe('App activity bridge', () => {
  it('rejects mismatched rooms and malformed envelopes', () => {
    expect(readCrewAppActivity({ source: 'crew-app-activity', version: 1, roomKey: 'other', events: [event] }, 'room')).toBeNull();
    expect(readCrewAppActivity({ source: 'workbench', version: 1, roomKey: 'room', events: [event] }, 'room')).toBeNull();
    expect(readCrewAppActivity({ source: 'crew-app-activity', version: 1, roomKey: 'room', events: [{}] }, 'room')?.events).toEqual([]);
  });
  it('deduplicates replayed history without rewriting failure as success', () => {
    const result = readCrewAppActivity({ source: 'crew-app-activity', version: 1, roomKey: 'room', events: [event] }, 'room')!;
    expect(mergeCrewAppActivity(result.events, result.events)).toEqual([event]);
    expect(readCrewAppActivity({ source: 'crew-app-activity', version: 1, roomKey: 'room', error: 'History unavailable (403)' }, 'room')?.error).toContain('403');
  });
});
