import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelGatewayService } from '../core/channel-gateway.service.js';
import { DiscordAdapter } from '../core/discord.adapter.js';
import type { ChannelAdapter, ChannelMessage, ChannelResponse, ChannelPlatform } from '../core/channel-gateway.types.js';

// ---------------------------------------------------------------------------
// Mock adapter for gateway tests
// ---------------------------------------------------------------------------

class MockAdapter implements ChannelAdapter {
    readonly platformId: ChannelPlatform = 'discord';
    public sentResponses: ChannelResponse[] = [];
    public parsedMessages: unknown[] = [];

    parseInbound(payload: unknown): ChannelMessage | null {
        this.parsedMessages.push(payload);
        const p = payload as any;
        if (p?.ignore) return null;
        return {
            id: 'msg-1',
            platform: 'discord',
            channelId: 'chan-123',
            senderId: 'user-abc',
            text: p?.text ?? 'hello',
            timestamp: new Date(),
        };
    }

    verifyWebhook(_headers: Record<string, string>, _rawBody: string): boolean {
        return true;
    }

    async sendResponse(response: ChannelResponse): Promise<void> {
        this.sentResponses.push(response);
    }
}

// ---------------------------------------------------------------------------
// ChannelGatewayService tests
// ---------------------------------------------------------------------------

describe('ChannelGatewayService', () => {
    let gateway: ChannelGatewayService;
    let mockAdapter: MockAdapter;

    beforeEach(() => {
        gateway = new ChannelGatewayService();
        mockAdapter = new MockAdapter();
        gateway.register(mockAdapter);
    });

    describe('register / has / deregister', () => {
        it('registers and detects an adapter', () => {
            expect(gateway.has('discord')).toBe(true);
        });

        it('returns false for unregistered platforms', () => {
            expect(gateway.has('slack')).toBe(false);
        });

        it('deregisters an adapter', async () => {
            await gateway.deregister('discord');
            expect(gateway.has('discord')).toBe(false);
        });
    });

    describe('handleWebhook', () => {
        it('returns null for unknown platform', async () => {
            const result = await gateway.handleWebhook('teams' as any, {}, '', {});
            expect(result).toBeNull();
        });

        it('returns null when parseInbound returns null', async () => {
            const result = await gateway.handleWebhook('discord', {}, '', { ignore: true });
            expect(result).toBeNull();
        });

        it('dispatches and sends response for valid message', async () => {
            const result = await gateway.handleWebhook('discord', {}, '', { text: 'hello there' });
            expect(result).not.toBeNull();
            expect(mockAdapter.sentResponses.length).toBe(1);
        });
    });

    describe('dispatch — intent routing', () => {
        const dispatch = (text: string) =>
            gateway.dispatch({ id: '1', platform: 'discord', channelId: 'c', senderId: 's', text, timestamp: new Date() }, mockAdapter);

        it('routes "run pipeline" intent', async () => {
            const r = await dispatch('run pipeline "my-pipe"');
            expect(r.intent).toBe('run_pipeline');
            expect(r.dispatched).toBe(true);
        });

        it('requires a name for run_pipeline, else dispatched=false', async () => {
            const r = await dispatch('run pipeline');
            expect(r.intent).toBe('run_pipeline');
            expect(r.dispatched).toBe(false);
        });

        it('routes "run mission" intent', async () => {
            const r = await dispatch('run mission "ops-weekly"');
            expect(r.intent).toBe('run_mission');
        });

        it('routes chitchat intent', async () => {
            const r = await dispatch('hello there');
            expect(r.intent).toBe('chitchat');
        });

        it('returns unknown intent for unrecognized text', async () => {
            const r = await dispatch('xyzzy42!@#$%^&*');
            expect(r.intent).toBe('unknown');
            expect(r.dispatched).toBe(false);
        });

        it('routes status query', async () => {
            const r = await dispatch('status of 42');
            expect(r.intent).toBe('query_status');
        });

        it('routes approval intent', async () => {
            const r = await dispatch('approve this request');
            expect(r.intent).toBe('human_approval');
        });
    });
});

// ---------------------------------------------------------------------------
// DiscordAdapter tests
// ---------------------------------------------------------------------------

describe('DiscordAdapter', () => {
    let adapter: DiscordAdapter;

    beforeEach(() => {
        adapter = new DiscordAdapter(); // no tokens = stub mode
    });

    describe('parseInbound', () => {
        it('returns null for PING (type 1)', () => {
            expect(adapter.parseInbound({ type: 1 })).toBeNull();
        });

        it('returns null for unknown type', () => {
            expect(adapter.parseInbound({ type: 99 })).toBeNull();
        });

        it('parses slash command (type 2)', () => {
            const payload = {
                type: 2,
                id: 'interaction-1',
                channel_id: 'chan-abc',
                member: { user: { id: 'user-1', username: 'alice' } },
                data: { name: 'run-pipeline', options: [{ name: 'name', value: 'my-pipe' }] },
            };
            const msg = adapter.parseInbound(payload);
            expect(msg).not.toBeNull();
            expect(msg!.platform).toBe('discord');
            expect(msg!.senderId).toBe('user-1');
            expect(msg!.text).toContain('run-pipeline');
        });

        it('returns null when text is empty', () => {
            const payload = { type: 2, data: { name: '' }, channel_id: 'c', member: { user: { id: 'u' } } };
            expect(adapter.parseInbound(payload)).toBeNull();
        });
    });

    describe('verifyWebhook', () => {
        it('throws when signature headers are missing', () => {
            expect(() => adapter.verifyWebhook({}, 'body')).toThrow('Missing Ed25519 signature headers');
        });

        it('returns true in stub mode (no publicKey)', () => {
            const result = adapter.verifyWebhook({
                'x-signature-ed25519': 'deadbeef',
                'x-signature-timestamp': '1234567890',
            }, 'body');
            expect(result).toBe(true);
        });
    });

    describe('sendResponse — stub mode', () => {
        it('does not throw when botToken is missing', async () => {
            await expect(adapter.sendResponse({
                platform: 'discord',
                channelId: 'chan-1',
                text: 'Hello',
            })).resolves.not.toThrow();
        });
    });
});
