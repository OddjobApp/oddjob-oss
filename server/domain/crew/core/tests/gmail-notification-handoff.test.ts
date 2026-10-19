import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const mocks = vi.hoisted(() => ({ notice: null as any, where: vi.fn(), read: vi.fn(), post: vi.fn(), find: vi.fn(), update: vi.fn() }));
vi.mock('@server/database_service.js', () => ({ db: { transaction: async (fn: any) => fn({ execute: async () => [], select: () => ({ from: () => ({ where: async (condition: any) => { mocks.where(condition); return mocks.notice ? [mocks.notice] : []; } }) }), update: () => ({ set: (values: any) => { mocks.update(values); return { where: async () => [] }; } }) }) } }));
vi.mock('@domain/tools/v1/capabilities/google-workspace.js', () => ({ GOOGLE_WORKSPACE_TOOLS: { gmail_get_message: { execute: mocks.read } } }));
vi.mock('../crew-repository.js', () => ({ crewRepository: { postTurn: mocks.post, findRoomTurn: mocks.find } }));
import { prepareGmailNotification } from '../gmail-notification-handoff.service.js';
import { gmailAlertRoute } from '@shared/gmail-notification-handoff.js';
const input = { orgId: 342, userId: 'u1', eventId: 7, room: { id: 9, organizationId: 342, projectId: 3, sessionKey: 'room' } as any };
beforeEach(() => {
    vi.clearAllMocks();
    mocks.notice = { id: 5, organizationId: 342, title: 'Important email: Review', description: 'New Gmail message from sender@example.com.', payload: { recipientUserId: 'u1', messageId: 'm1', route: '/workspace/chat/room?orgId=342&gmailAlert=7' } };
    mocks.read.mockResolvedValue(JSON.stringify({ id: 'm1', threadId: 't1', snippet: 'Review today', payload: { headers: [{ name: 'Subject', value: 'Review' }, { name: 'From', value: 'Sender <sender@example.com>' }], mimeType: 'text/plain', decodedText: 'Full source content' } }));
    mocks.post.mockImplementation(async (_org: any, _room: any, values: any) => ({ id: 42, ...values }));
    mocks.find.mockResolvedValue(undefined);
});
describe('Private Gmail notification handoff', () => {
    it('preserves org and event identity in push URLs and rejects offsite targets', () => {
        expect(gmailAlertRoute('/workspace/chat/room?orgId=342', 7)).toBe('/workspace/chat/room?orgId=342&gmailAlert=7');
        expect(gmailAlertRoute('https://evil.example/workspace/chat/room', 7)).toBe('/');
    });
    it('reads the exact saved message, persists its card, and returns source context without AI', async () => {
        const result = await prepareGmailNotification(input);
        expect(mocks.read).toHaveBeenCalledWith({ message_id: 'm1' }, { organizationId: 342, projectId: 3 });
        expect((result.payload.items as any[])[0]).toMatchObject({ id: 'm1', title: 'Review', body: 'Full source content' });
        expect((result.payload.items as any[])[0].senderProfile).toMatchObject({ email: 'sender@example.com', displayName: 'Sender', intentions: [] });
        expect(mocks.update.mock.calls[0][0].payload.senderProfile.email).toBe('sender@example.com');
        expect(result.turn.id).toBe(42);
        expect(mocks.update.mock.calls[0][0].payload.contextTurnId).toBe(42);
        const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
        expect(query.params).toEqual(expect.arrayContaining([342, 7, 'gmail_directive:u1']));
    });
    it('reuses the persisted card when the same notification is opened again', async () => {
        const first = await prepareGmailNotification(input);
        mocks.notice.payload.contextTurnId = 42;
        mocks.find.mockResolvedValue(first.turn);
        const second = await prepareGmailNotification(input);
        expect(second.turn.id).toBe(42);
        expect(mocks.post).toHaveBeenCalledTimes(1);
        expect(mocks.read).toHaveBeenCalledTimes(1);
    });
    it('rejects another user’s alert before reading the mailbox', async () => {
        mocks.notice.payload.recipientUserId = 'u2';
        await expect(prepareGmailNotification(input)).rejects.toThrow('unavailable');
        expect(mocks.read).not.toHaveBeenCalled();
    });
    it('rejects another organization or room before reading the mailbox', async () => {
        mocks.notice.organizationId = 473;
        await expect(prepareGmailNotification(input)).rejects.toThrow('unavailable');
        mocks.notice.organizationId = 342;
        mocks.notice.payload.route = '/workspace/chat/other-room?orgId=342';
        await expect(prepareGmailNotification(input)).rejects.toThrow('another room');
        expect(mocks.read).not.toHaveBeenCalled();
    });
    it('reports an actual source failure without saving an empty or fabricated context', async () => {
        mocks.read.mockRejectedValue(new Error('Gmail access expired'));
        await expect(prepareGmailNotification(input)).rejects.toThrow('Gmail access expired');
        expect(mocks.post).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
    });
});
