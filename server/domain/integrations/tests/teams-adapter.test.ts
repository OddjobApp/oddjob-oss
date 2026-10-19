import { describe, it, expect, beforeEach } from 'vitest';
import { TeamsAdapter } from '../core/teams.adapter.js';
import type { ChannelMessage } from '../core/channel-gateway.types.js';

describe('TeamsAdapter', () => {
    let adapter: TeamsAdapter;

    beforeEach(() => {
        adapter = new TeamsAdapter(); // no credentials = stub mode
    });

    describe('parseInbound', () => {
        it('returns null for non-message activity types', () => {
            expect(adapter.parseInbound({ type: 'conversationUpdate' })).toBeNull();
            expect(adapter.parseInbound({ type: 'invoke' })).toBeNull();
            expect(adapter.parseInbound({ type: 'typing' })).toBeNull();
        });

        it('returns null if text is empty after stripping mentions', () => {
            const payload = {
                type: 'message',
                text: '<at>Oddjob</at>',
                from: { id: 'u1' },
                conversation: { id: 'c1' },
            };
            expect(adapter.parseInbound(payload)).toBeNull();
        });

        it('parses a simple message activity', () => {
            const payload = {
                type: 'message',
                id: 'act-1',
                text: 'run pipeline "deploy"',
                from: { id: 'user-1', name: 'Alice' },
                conversation: { id: 'conv-abc' },
                timestamp: '2026-07-01T00:00:00Z',
            };
            const msg = adapter.parseInbound(payload) as ChannelMessage;
            expect(msg).not.toBeNull();
            expect(msg.platform).toBe('teams');
            expect(msg.senderId).toBe('user-1');
            expect(msg.senderName).toBe('Alice');
            expect(msg.channelId).toBe('conv-abc');
            expect(msg.text).toBe('run pipeline "deploy"');
        });

        it('strips @mention tags from text', () => {
            const payload = {
                type: 'message',
                text: '<at>Oddjob Bot</at> run mission "weekly-sync"',
                from: { id: 'u1' },
                conversation: { id: 'c1' },
            };
            const msg = adapter.parseInbound(payload) as ChannelMessage;
            expect(msg).not.toBeNull();
            expect(msg.text).toBe('run mission "weekly-sync"');
        });

        it('preserves replyToId as threadId', () => {
            const payload = {
                type: 'message',
                text: 'hello',
                from: { id: 'u1' },
                conversation: { id: 'c1' },
                replyToId: 'parent-msg-42',
            };
            const msg = adapter.parseInbound(payload) as ChannelMessage;
            expect(msg?.threadId).toBe('parent-msg-42');
        });
    });

    // verifyWebhook is async now that it validates the activity JWT against
    // Microsoft's published JWKS. Signature and claim coverage lives in
    // bot-framework-jwt.test.ts, which signs with real RSA keys; these two keep
    // asserting the behaviour that does not need a key.
    describe('verifyWebhook', () => {
        it('rejects when Authorization header is missing', async () => {
            await expect(adapter.verifyWebhook({}, 'body')).rejects.toThrow('Missing Authorization header');
        });

        it('returns true in stub mode (no appId), where there is nothing to verify against', async () => {
            await expect(
                adapter.verifyWebhook({ authorization: 'Bearer token123' }, 'body'),
            ).resolves.toBe(true);
        });
    });

    describe('sendResponse — stub mode', () => {
        it('does not throw when credentials are missing', async () => {
            await expect(adapter.sendResponse({
                platform: 'teams',
                channelId: 'conv-1',
                text: 'Hello Teams!',
            })).resolves.not.toThrow();
        });
    });
});
