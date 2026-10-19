import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ accountInfo: vi.fn(), searchMeetings: vi.fn(), listMeetings: vi.fn(), listFolders: vi.fn(), getMeetings: vi.fn(), getTranscript: vi.fn(), get: vi.fn(), findRoom: vi.fn(), shared: vi.fn() }));
vi.mock('@domain/integrations/granola/service.js', () => ({ getGranolaForContext: mocks.get }));
vi.mock('@domain/integrations/granola/rooms.js', () => ({ findRoom: mocks.findRoom, sharedMeetings: mocks.shared, GRANOLA_PRIVATE_RESULTS: 'granola_private_results' }));
import { GRANOLA_TOOLS } from './granola.js';

beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue({ client: mocks });
    mocks.findRoom.mockResolvedValue({ id: 5, sessionKey: 'room-1' });
    mocks.shared.mockResolvedValue([]);
});

describe('Granola capabilities', () => {
    it('passes the caller context to the scoped connection resolver', async () => {
        mocks.searchMeetings.mockResolvedValue({ meetings: [{ id: 'm1' }] });
        const context = { organizationId: 12, userId: 'u1' };
        const result = JSON.parse(await GRANOLA_TOOLS.granola_search_meetings.execute({ query: 'launch decision' }, context));
        expect(mocks.get).toHaveBeenCalledWith(context);
        expect(mocks.searchMeetings).toHaveBeenCalledWith('launch decision');
        expect(result.meetings[0].id).toBe('m1');
    });

    it('propagates missing-connection failures so tool evidence is marked failed', async () => {
        mocks.get.mockRejectedValue(new Error('Link your Granola account'));
        await expect(GRANOLA_TOOLS.granola_list_meetings.execute({}, { organizationId: 12, userId: 'u2' })).rejects.toThrow('Link your Granola account');
    });

    it('declares every Granola capability read-safe', () => {
        expect(Object.values(GRANOLA_TOOLS).every(tool => tool.idempotency === 'read-safe')).toBe(true);
    });
});

/**
 * No room is readable by one person only, so in a room Granola content stays
 * with the person who asked until they share a meeting.
 */
describe('Granola in a CREW room', () => {
    const room = { organizationId: 12, userId: 'u1', sessionKey: 'room-1' };

    it('gives the agent a count and a card with no meeting data', async () => {
        mocks.searchMeetings.mockResolvedValue({ meetings: [{ id: 'm1', title: 'Board: layoffs', notes: 'secret' }, { id: 'm2', title: 'Offsite' }] });
        const raw = await GRANOLA_TOOLS.granola_search_meetings.execute({ query: 'budget' }, room);
        const result = JSON.parse(raw);
        expect(result).toMatchObject({ type: 'granola_private_results', private: true, ownerUserId: 'u1', sessionKey: 'room-1', organizationId: 12, count: 2, query: 'budget' });
        expect(raw).not.toMatch(/layoffs|secret|Offsite|m1|m2/);
    });

    it('lists privately too', async () => {
        mocks.listMeetings.mockResolvedValue([{ id: 'm1', title: 'Standup' }]);
        const raw = await GRANOLA_TOOLS.granola_list_meetings.execute({ limit: 5 }, room);
        expect(JSON.parse(raw)).toMatchObject({ type: 'granola_private_results', count: 1, list: { limit: 5 } });
        expect(raw).not.toContain('Standup');
    });

    it('reads only meetings shared into the room, from the shared snapshot, never live', async () => {
        mocks.shared.mockResolvedValue([{ meetingId: 'm1', sharedBy: 'u9', turnId: 40, item: { id: 'm1', title: 'Roadmap', body: 'Ship it' } }]);
        const result = JSON.parse(await GRANOLA_TOOLS.granola_get_meeting.execute({ meeting_ids: ['m1'] }, room));
        expect(result).toEqual({ shared: true, meetings: [{ id: 'm1', title: 'Roadmap', body: 'Ship it', sharedBy: 'u9' }] });
        expect(mocks.getMeetings).not.toHaveBeenCalled();
    });

    it('refuses a meeting nobody shared into the room', async () => {
        await expect(GRANOLA_TOOLS.granola_get_meeting.execute({ meeting_ids: ['m7'] }, room)).rejects.toThrow(/Not shared into this room: m7/);
        expect(mocks.getMeetings).not.toHaveBeenCalled();
    });

    it('refuses transcripts and folders, and hides account details', async () => {
        await expect(GRANOLA_TOOLS.granola_get_meeting_transcript.execute({ meeting_id: 'm1' }, room)).rejects.toThrow(/not read in a room/);
        await expect(GRANOLA_TOOLS.granola_list_meeting_folders.execute({}, room)).rejects.toThrow(/not listed in a room/);
        mocks.accountInfo.mockResolvedValue({ email: 'me@example.com' });
        expect(JSON.parse(await GRANOLA_TOOLS.granola_get_account.execute({}, room))).toEqual({ connected: true });
        expect(mocks.getTranscript).not.toHaveBeenCalled();
    });

    it('fails closed when the room key resolves to nothing', async () => {
        mocks.findRoom.mockResolvedValue(null);
        await expect(GRANOLA_TOOLS.granola_search_meetings.execute({ query: 'x' }, room)).rejects.toThrow(/room was not found/);
        expect(mocks.searchMeetings).not.toHaveBeenCalled();
    });
});
