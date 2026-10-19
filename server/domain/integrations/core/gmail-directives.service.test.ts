import { describe, expect, it, vi } from 'vitest';
vi.mock('@server/database_service.js', () => ({ db: {} }));
vi.mock('../google-workspace-connector-bridge.js', () => ({ getGoogleWorkspaceToken: vi.fn() }));
vi.mock('@domain/core/notifications/push.service.js', () => ({ pushService: {} }));
import { matchesGmailSender, parseGmailDirective } from './gmail-directives.service.js';
describe('Deterministic Gmail directives', () => {
  it('parses a sender alert without AI and supports pause, resume and status', () => {
    expect(parseGmailDirective('/directive Any email from Owner@Example.com is important. Notify me immediately.')).toEqual({ sender: 'owner@example.com', action: 'create' });
    for (const action of ['pause', 'resume', 'status', 'remove']) expect(parseGmailDirective(`/directive ${action} owner@example.com`)?.action).toBe(action);
    expect(parseGmailDirective('Summarize my email')).toBeNull();
    expect(parseGmailDirective('/directive list')?.action).toBe('list');
    expect(parseGmailDirective('/directives')?.action).toBe('list');
    expect(() => parseGmailDirective('/directive Notify me about important emails')).toThrow();
  });
  it('matches the actual From mailbox exactly and only newly arrived inbound messages', () => {
    const message = { internalDate: '2000', labelIds: ['INBOX'], payload: { headers: [{ name: 'From', value: 'Jann <Owner@Example.com>' }] } };
    expect(matchesGmailSender(message, 'owner@example.com', 1000)).toBe(true);
    expect(matchesGmailSender(message, 'someone@gmail.com', 1000)).toBe(false);
    expect(matchesGmailSender(message, 'owner@example.com', 3000)).toBe(false);
    expect(matchesGmailSender({ ...message, labelIds: ['SENT'] }, 'owner@example.com', 1000)).toBe(false);
    expect(matchesGmailSender({ ...message, payload: { headers: [{ name: 'From', value: 'owner@example.com <impostor@example.com>' }] } }, 'owner@example.com', 1000)).toBe(false);
  });
});
