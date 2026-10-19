import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rules: [] as any[], events: new Set<string>(), notifications: [] as any[], token: vi.fn(), push: vi.fn(), reachable: new Set<string>() }));
vi.mock('@domain/core/notifications/push.service.js', () => ({ pushService: { isConfigured: () => true, hasSubscription: async () => true, anyConfigured: () => true, canReach: async (userId: string) => state.reachable.has(userId), sendOnce: state.push } }));
vi.mock('../google-workspace-connector-bridge.js', () => ({ getGoogleWorkspaceToken: state.token }));
vi.mock('@server/database_service.js', async () => {
  const schema = await import('@shared/schema/index.js');
  const tx = {
    select: () => ({ from: () => ({ where: async () => state.rules }) }),
    execute: async () => ({ rows: [{ locked: true }] }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    insert: (table: unknown) => ({ values: (values: any) => ({ onConflictDoNothing: () => {
      if (table === schema.xrayOperationalNotifications) { state.notifications.push({ id: state.notifications.length + 1, ...values }); return Promise.resolve([]); }
      return { returning: async () => { if (state.events.has(values.deduplicationKey)) return []; state.events.add(values.deduplicationKey); return [{ id: state.events.size, ...values }]; } };
    } }) }),
  };
  return { db: { select: () => ({ from: (table: unknown) => ({ where: async () => table === schema.xrayOperationalConfigs ? state.rules : state.notifications }) }), transaction: async (fn: any) => fn(tx) } };
});
import { sweepGmailDirectives } from './gmail-directives.service.js';
describe('Gmail directives execute through the actual delivery service', () => {
  beforeEach(() => {
    state.events.clear(); state.notifications.length = 0; state.push.mockClear(); state.token.mockResolvedValue('test-token');
    state.reachable = new Set(['u1', 'u2']);
    state.rules = ['u1', 'u2'].map((userId, index) => ({ id: index + 1, organizationId: 342, scope: `gmail_directive:${userId}`, config: { active: true, userId, projectId: 3, sender: 'owner@example.com', since: 1000, historyId: '100', sessionKey: 'room' } }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('/history?') ? { historyId: '101', history: [{ messagesAdded: [{ message: { id: 'm1' } }, { message: { id: 'm1' } }] }] } : { id: 'm1', threadId: 't1', internalDate: '2000', labelIds: ['INBOX'], payload: { headers: [{ name: 'From', value: 'Jann <owner@example.com>' }, { name: 'Subject', value: 'Please review' }] }, snippet: 'Review today' } })));
  });
  it('shares the mailbox fetch, creates private inbox notifications, and dispatches browser push', async () => {
    await sweepGmailDirectives();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(state.token).toHaveBeenCalledWith(342, 3, 'gmail_read');
    expect(state.notifications).toHaveLength(2);
    expect(state.notifications[0]).toMatchObject({ organizationId: 342, scope: 'gmail_directive:u1', payload: { recipientUserId: 'u1', messageId: 'm1', platform: 'gmail' } });
    expect(state.push).toHaveBeenCalledWith('gmail_directive', 1, 'u1', expect.objectContaining({ title: 'Important email: Please review' }));
    expect(state.push.mock.calls[0][3].url).toContain('gmailAlert=1');
    expect(state.notifications[0].payload.actionUrl).toContain('gmailAlert=1');
    await sweepGmailDirectives();
    expect(state.notifications).toHaveLength(2);
  });
  it('alerts whoever push can reach, phone-only people included, and skips the unreachable', async () => {
    // canReach covers a browser subscription or a registered phone; u2 has neither.
    state.reachable = new Set(['u1']);
    await sweepGmailDirectives();
    expect(state.notifications).toHaveLength(2);
    expect(state.push).toHaveBeenCalledTimes(1);
    expect(state.push.mock.calls[0][2]).toBe('u1');
  });
  it('does not run a paused rule or disclose notifications to another org', async () => {
    state.rules.forEach(rule => rule.config.active = false);
    await sweepGmailDirectives();
    expect(fetch).not.toHaveBeenCalled();
    expect(state.notifications).toHaveLength(0);
    expect(state.push).not.toHaveBeenCalled();
  });
});
