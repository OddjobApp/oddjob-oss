/**
 * Microsoft Teams Channel Adapter
 *
 * Implements the ChannelAdapter interface for Microsoft Teams via the
 * Bot Framework REST API (Azure Bot Service).
 *
 * Handles:
 *  - Outbound message dispatch via Bot Framework Activity API
 *  - Inbound activity parsing (message, mention, adaptive card submission)
 *  - Inbound JWT validation against the Bot Framework JWKS (RS256)
 *
 * Configuration (env vars):
 *   TEAMS_BOT_APP_ID          Azure Bot app ID
 *   TEAMS_BOT_APP_PASSWORD    Azure Bot app password / client secret
 *   TEAMS_BOT_TENANT_ID       (optional) restrict to a single AAD tenant
 *
 * Phase 5 stub: full OAuth2 token acquisition for outbound calls and
 * Adaptive Card rich content support are planned for Phase 5.2.
 */

import { createLogger } from '@server/utils/logger.js';
import { BotFrameworkJwtVerifier, botFrameworkJwtVerifier } from './bot-framework-jwt.js';
import type {
    ChannelAdapter,
    ChannelMessage,
    ChannelResponse,
    ChannelPlatform,
} from './channel-gateway.types.js';

const logger = createLogger('TeamsAdapter');

// Bot Framework token endpoint
const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token';
const BOT_FRAMEWORK_API = 'https://smba.trafficmanager.net/apis';

export class TeamsAdapter implements ChannelAdapter {
    readonly platformId: ChannelPlatform = 'teams';

    private readonly appId: string;
    private readonly appPassword: string;
    private readonly tenantId: string | undefined;

    /** Cached OAuth access token + expiry */
    private _token: string | null = null;
    private _tokenExpiry = 0;

    private readonly jwtVerifier: BotFrameworkJwtVerifier;

    constructor(
        appId = process.env.TEAMS_BOT_APP_ID ?? '',
        appPassword = process.env.TEAMS_BOT_APP_PASSWORD ?? '',
        tenantId = process.env.TEAMS_BOT_TENANT_ID,
        jwtVerifier: BotFrameworkJwtVerifier = botFrameworkJwtVerifier
    ) {
        this.appId = appId;
        this.appPassword = appPassword;
        this.tenantId = tenantId;
        this.jwtVerifier = jwtVerifier;
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    async initialize(): Promise<void> {
        if (!this.appId || !this.appPassword) {
            logger.warn('[TeamsAdapter] TEAMS_BOT_APP_ID / TEAMS_BOT_APP_PASSWORD not set — stub mode.');
            return;
        }
        logger.info('[TeamsAdapter] Initialized (credentials present).');
    }

    async destroy(): Promise<void> {
        this._token = null;
        logger.info('[TeamsAdapter] Destroyed.');
    }

    // -----------------------------------------------------------------------
    // Webhook verification
    // -----------------------------------------------------------------------

    /**
     * Bot Framework webhook verification.
     * Microsoft sends a JWT bearer token in the Authorization header.
     * Full JWT validation (RS256 with JWKS) is planned for Phase 5.2.
     * In stub mode we confirm the header exists.
     *
     * @throws Error if the authorization header is missing entirely.
     */
    async verifyWebhook(headers: Record<string, string>, _rawBody: string): Promise<boolean> {
        const auth = headers['authorization'] ?? headers['Authorization'];
        if (!auth) {
            throw new Error('[TeamsAdapter] Missing Authorization header — cannot verify Teams webhook.');
        }

        if (!this.appId) {
            // Nothing to validate the audience against. Announced as unverified
            // rather than reported as a pass.
            logger.warn('[TeamsAdapter] No TEAMS_BOT_APP_ID set — Teams JWT NOT verified.');
            return true;
        }

        try {
            const verified = await this.jwtVerifier.verify(auth, this.appId);

            // A single-tenant bot additionally pins the AAD tenant. The claim is
            // only trustworthy because the signature was checked first.
            if (this.tenantId) {
                const tokenTenant = String(
                    (verified.claims as any).tid ?? (verified.claims as any).tenantId ?? '',
                );
                if (tokenTenant && tokenTenant !== this.tenantId) {
                    throw new Error(`activity is from tenant ${tokenTenant}, not ${this.tenantId}`);
                }
            }

            return true;
        } catch (error: any) {
            // The message deliberately carries the reason but not the token.
            throw new Error(`[TeamsAdapter] Teams JWT verification failed: ${error?.message ?? error}`);
        }
    }

    // -----------------------------------------------------------------------
    // Inbound parsing
    // -----------------------------------------------------------------------

    /**
     * Parse a Bot Framework Activity into a normalized ChannelMessage.
     * Returns null for non-message activities (invoke, typing, etc.)
     */
    parseInbound(payload: unknown): ChannelMessage | null {
        const p = payload as any;

        // Only handle 'message' activities (ignore invoke, conversationUpdate, etc.)
        if (p?.type !== 'message') return null;

        const text = (p?.text ?? '').replace(/<at>.*?<\/at>/gi, '').trim();
        if (!text) return null;

        const senderId = p?.from?.id ?? 'unknown';
        const senderName = p?.from?.name;
        const channelId = p?.conversation?.id ?? 'unknown';
        const threadId = p?.replyToId;

        return {
            id: p?.id ?? `teams-${Date.now()}`,
            platform: 'teams',
            channelId,
            threadId,
            senderId,
            senderName,
            text,
            raw: payload,
            timestamp: p?.timestamp ? new Date(p.timestamp) : new Date(),
        };
    }

    // -----------------------------------------------------------------------
    // Outbound response
    // -----------------------------------------------------------------------

    /**
     * Send a message to a Teams conversation via Bot Framework.
     * Falls back to a warning log when credentials are not configured.
     */
    async sendResponse(response: ChannelResponse): Promise<void> {
        if (!this.appId || !this.appPassword) {
            logger.warn(`[TeamsAdapter] Stub send to channel ${response.channelId}: ${response.text}`);
            return;
        }

        const token = await this.getAccessToken();
        const url = `${BOT_FRAMEWORK_API}/v3/conversations/${response.channelId}/activities`;

        const activity: Record<string, unknown> = {
            type: 'message',
            text: response.text,
        };

        if (response.threadId) {
            activity['replyToId'] = response.threadId;
        }

        if (response.richContent) {
            // Adaptive Card
            activity['attachments'] = [{
                contentType: 'application/vnd.microsoft.card.adaptive',
                content: response.richContent,
            }];
        }

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(activity),
            });

            if (!res.ok) {
                const err = await res.text();
                logger.error(`[TeamsAdapter] Failed to send message: ${res.status} ${err}`);
            } else {
                logger.debug(`[TeamsAdapter] Message sent to conversation ${response.channelId}`);
            }
        } catch (err: any) {
            logger.error(`[TeamsAdapter] Network error: ${err.message}`);
        }
    }

    // -----------------------------------------------------------------------
    // OAuth2 token acquisition (Bot Framework client_credentials)
    // -----------------------------------------------------------------------

    private async getAccessToken(): Promise<string> {
        if (this._token && Date.now() < this._tokenExpiry - 60_000) {
            return this._token;
        }

        const params = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.appId,
            client_secret: this.appPassword,
            scope: 'https://api.botframework.com/.default',
        });

        const res = await fetch(TOKEN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });

        if (!res.ok) {
            throw new Error(`[TeamsAdapter] Token acquisition failed: ${res.status}`);
        }

        const json: any = await res.json();
        this._token = json.access_token;
        this._tokenExpiry = Date.now() + (json.expires_in ?? 3600) * 1000;
        return this._token!;
    }
}

// Singleton (configured from environment)
export const teamsAdapter = new TeamsAdapter();
