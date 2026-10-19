import { describe, expect, it } from 'vitest';
import { workspaceResultPayload } from './crew-workspace-results.js';

describe('Granola workspace result cards', () => {
    it('maps meeting notes into selectable meeting cards', () => {
        const payload = workspaceResultPayload('granola_get_meeting', { meetings: [{ id: 'meeting-1', title: 'Roadmap review', date: '2026-10-10T16:00:00Z', attendees: [{ name: 'Alex' }, { email: 'sam@example.com' }], summary: 'Decided to ship the staged rollout.', url: 'https://notes.granola.ai/d/meeting-1' }] }, { meeting_ids: ['meeting-1'] });
        expect(payload?.items[0]).toMatchObject({ id: 'meeting-1', kind: 'meeting', platform: 'granola', title: 'Roadmap review', attendees: ['Alex', 'sam@example.com'] });
        expect(payload?.items[0].preview).toContain('staged rollout');
    });

    it('renders no card from a private room search or a shared snapshot', () => {
        expect(workspaceResultPayload('granola_search_meetings', { type: 'granola_private_results', private: true, count: 3 }, { query: 'x' })).toBeNull();
        expect(workspaceResultPayload('granola_get_meeting', { shared: true, meetings: [{ id: 'm1', title: 'Roadmap' }] }, { meeting_ids: ['m1'] })).toBeNull();
    });
});
