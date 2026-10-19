/**
 * Discord Channel Adapter
 *
 * Implements the ChannelAdapter interface for Discord.
 * Handles:
 *  - Outbound message dispatch via Discord Webhooks (simple) or Bot API
 *  - Inbound message parsing from Discord interaction payloads
 *  - Ed25519 signature verification (Discord's mandatory security requirement)
 *
 * Configuration (env vars):
 *   DISCORD_BOT_TOKEN           Bot token for the Discord API
 *   DISCORD_PUBLIC_KEY          Application public key (for Ed25519 verification)
 *   DISCORD_APPLICATION_ID      Discord application ID
 *
 * Phase 5 stub: full slash-command registration, thread management, and rich
 * embed formatting are planned for Phase 5.1.
 */

import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

import { createLogger } from '@server/utils/logger.js';
import type {
    ChannelAdapter,
    ChannelMessage,
    ChannelResponse,
    ChannelPlatform,
} from './channel-gateway.types.js';

const logger = createLogger('DiscordAdapter');

// Discord API base URL
const DISCORD_API = 'https://discord.com/api/v10';

export class DiscordAdapter implements ChannelAdapter {
    readonly platformId: ChannelPlatform = 'discord';

    private readonly botToken: string;
    private readonly publicKey: string;
    private readonly applicationId: string;

    constructor(
        botToken = process.env.DISCORD_BOT_TOKEN ?? '',
        publicKey = process.env.DISCORD_PUBLIC_KEY ?? '',
        applicationId = process.env.DISCORD_APPLICATION_ID ?? ''
    ) {
        this.botToken = botToken;
        this.publicKey = publicKey;
        this.applicationId = applicationId;
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    async initialize(): Promise<void> {
        if (!this.botToken) {
            logger.warn('[DiscordAdapter] DISCORD_BOT_TOKEN is not set — adapter running in stub mode.');
            return;
        }
        logger.info('[DiscordAdapter] Initialized (bot token present).');
    }

    async destroy(): Promise<void> {
        logger.info('[DiscordAdapter] Destroyed.');
    }

    // -----------------------------------------------------------------------
    // Webhook verification
    // -----------------------------------------------------------------------

    /**
     * Verifies Discord's mandatory Ed25519 interaction signature.
     *
     * This returned `true` unconditionally, including when DISCORD_PUBLIC_KEY
     * was set — so configuring the key bought nothing, and any caller could
     * post a forged interaction to the inbound webhook. The signature is over
     * `timestamp + rawBody`, so the raw body must be the bytes Discord sent;
     * a re-serialized object will not verify.
     *
     * Node can do this natively: an Ed25519 public key is a 32-byte value, and
     * `createPublicKey` accepts it wrapped in the fixed SPKI prefix for the
     * curve, which avoids a dependency on tweetnacl.
     *
     * @throws Error if the signature headers are missing, or if a public key is
     *         configured and the signature does not verify.
     */
    verifyWebhook(headers: Record<string, string>, rawBody: string): boolean {
        const signature = headers['x-signature-ed25519'] ?? headers['X-Signature-Ed25519'];
        const timestamp = headers['x-signature-timestamp'] ?? headers['X-Signature-Timestamp'];

        if (!signature || !timestamp) {
            throw new Error('[DiscordAdapter] Missing Ed25519 signature headers.');
        }

        if (!this.publicKey) {
            // No key configured: the adapter cannot verify anything. This is
            // announced loudly rather than reported as a pass.
            logger.warn('[DiscordAdapter] No DISCORD_PUBLIC_KEY set — signature NOT verified.');
            return true;
        }

        let verified = false;
        try {
            const keyBytes = Buffer.from(this.publicKey, 'hex');
            if (keyBytes.length !== 32) {
                throw new Error(`expected a 32-byte hex public key, got ${keyBytes.length} bytes`);
            }
            // SPKI DER prefix for Ed25519 (RFC 8410): 12 bytes, then the raw key.
            const spki = Buffer.concat([
                Buffer.from('302a300506032b6570032100', 'hex'),
                keyBytes,
            ]);
            const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });

            const sigBytes = Buffer.from(signature, 'hex');
            if (sigBytes.length !== 64) {
                throw new Error(`expected a 64-byte hex signature, got ${sigBytes.length} bytes`);
            }

            verified = cryptoVerify(
                null,
                Buffer.concat([Buffer.from(timestamp, 'utf8'), Buffer.from(rawBody, 'utf8')]),
                key,
                sigBytes,
            );
        } catch (error: any) {
            // A malformed key or signature is a failed verification, never a pass.
            logger.warn(`[DiscordAdapter] Ed25519 verification could not be performed: ${error?.message ?? error}`);
            throw new Error('[DiscordAdapter] Ed25519 signature verification failed.');
        }

        if (!verified) {
            // Fingerprint only — never log the signature or the body.
            logger.warn(
                `[DiscordAdapter] Rejected a Discord interaction with an invalid Ed25519 signature ` +
                `(body sha256 ${createHash('sha256').update(rawBody).digest('hex').slice(0, 12)}).`,
            );
            throw new Error('[DiscordAdapter] Ed25519 signature verification failed.');
        }

        return true;
    }

    // -----------------------------------------------------------------------
    // Inbound parsing
    // -----------------------------------------------------------------------

    /**
     * Parse a Discord interaction webhook payload into a normalized ChannelMessage.
     * Returns null for ACK/ping requests and bot messages.
     */
    parseInbound(payload: unknown): ChannelMessage | null {
        const p = payload as any;

        // Type 1 = PING (Discord health check) — return null to ACK without processing
        if (p?.type === 1) return null;

        // Type 2 = APPLICATION_COMMAND (slash command)
        // Type 3 = MESSAGE_COMPONENT (button/select interaction)
        if (p?.type !== 2 && p?.type !== 3) return null;

        const userId   = p?.member?.user?.id ?? p?.user?.id ?? 'unknown';
        const userName = p?.member?.user?.username ?? p?.user?.username;
        const channelId = p?.channel_id ?? 'unknown';
        const guildId  = p?.guild_id;

        // Extract text from slash command or message content
        let text = '';
        if (p?.data?.name) {
            // Slash command: /run-pipeline name:foo
            const opts = (p?.data?.options ?? []) as Array<{ name: string; value: string }>;
            const args = opts.map((o: any) => `${o.name}: ${o.value}`).join(', ');
            text = `${p.data.name}${args ? ` ${args}` : ''}`;
        } else if (p?.message?.content) {
            text = p.message.content;
        }

        if (!text.trim()) return null;

        return {
            id: p?.id ?? `discord-${Date.now()}`,
            platform: 'discord',
            channelId,
            threadId: guildId,
            senderId: userId,
            senderName: userName,
            text: text.trim(),
            raw: payload,
            timestamp: new Date(),
        };
    }

    // -----------------------------------------------------------------------
    // Outbound response
    // -----------------------------------------------------------------------

    /**
     * Send a response to a Discord channel via the REST API.
     * Falls back to a warning log when botToken is not configured.
     */
    async sendResponse(response: ChannelResponse): Promise<void> {
        if (!this.botToken) {
            logger.warn(
                `[DiscordAdapter] Stub send to channel ${response.channelId}: ${response.text}`
            );
            return;
        }

        const url = `${DISCORD_API}/channels/${response.channelId}/messages`;
        const body: Record<string, unknown> = { content: response.text };

        // Thread reply
        if (response.threadId) {
            body['message_reference'] = { message_id: response.threadId };
        }

        // Rich embeds (Discord Embed object)
        if (response.richContent) {
            body['embeds'] = [response.richContent];
        }

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bot ${this.botToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const err = await res.text();
                logger.error(`[DiscordAdapter] Failed to send message: ${res.status} ${err}`);
            } else {
                logger.debug(`[DiscordAdapter] Message sent to channel ${response.channelId}`);
            }
        } catch (err: any) {
            logger.error(`[DiscordAdapter] Network error: ${err.message}`);
        }
    }
}

// Export singleton (configured from environment)
export const discordAdapter = new DiscordAdapter();
