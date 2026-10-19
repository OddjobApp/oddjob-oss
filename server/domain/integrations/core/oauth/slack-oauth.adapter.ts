/**
 * Slack OAuth v2 Adapter
 * 
 * Handles multi-workspace Slack OAuth installation flow (bot tokens, user tokens,
 * team identification, and encrypted credential storage).
 */

import { BaseOAuthAdapter } from "./base-oauth.adapter.js";
import { OAuthReauthorizationRequiredError } from "./reauthorization.js";
import type { OAuthProviderConfig, OAuthTokens, OAuthStatePayload } from "./oauth-adapter.types.js";
import { db } from "@server/database_service.js";
import { saasConnectors } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SlackOAuthAdapter");

export class SlackOAuthAdapter extends BaseOAuthAdapter {
    readonly platform = "slack";
    readonly callbackPath = "/api/integrations/slack/callback";

    readonly config: OAuthProviderConfig = {
        platform: "slack",
        authorizeUrl: "https://slack.com/oauth/v2/authorize",
        tokenUrl: "https://slack.com/api/oauth.v2.access",
        defaultScopes: [
            "chat:write",
            "channels:read",
            "groups:read",
            "im:read",
            "mpim:read",
            "app_mentions:read",
            "users:read",
            "commands",
        ],
        usePkce: false,
        supportsOfflineAccess: false,
    };

    protected getClientId(): string {
        return process.env.SLACK_CLIENT_ID || "";
    }

    protected getClientSecret(): string {
        return process.env.SLACK_CLIENT_SECRET || "";
    }

    public async exchangeCodeForTokens(
        code: string,
        redirectUri: string,
        _codeVerifier?: string
    ): Promise<OAuthTokens> {
        const clientId = this.getClientId();
        const clientSecret = this.getClientSecret();

        if (!clientId || !clientSecret) {
            throw new Error("Slack OAuth credentials not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET.");
        }

        const params = new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
        });

        const res = await fetch(this.config.tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
        });

        if (!res.ok) {
            const errText = await res.text();
            logger.error("Failed to exchange Slack code for token", { error: errText });
            throw new Error(`Slack token exchange failed with status ${res.status}: ${errText}`);
        }

        const data = await res.json();
        if (!data.ok) {
            logger.error("Slack API error during OAuth code exchange", { error: data.error });
            throw new Error(`Slack OAuth error: ${data.error}`);
        }

        const expiresInSec = typeof data.expires_in === "number" ? data.expires_in : undefined;

        return {
            accessToken: data.access_token, // Bot token xoxb-...
            refreshToken: data.refresh_token,
            tokenType: data.token_type || "Bearer",
            expiresAt: expiresInSec ? new Date(Date.now() + expiresInSec * 1000) : null,
            scopes: data.scope ? data.scope.split(",") : this.config.defaultScopes,
            rawPayload: {
                team: data.team,
                enterprise: data.enterprise,
                authedUser: data.authed_user,
                botUserId: data.bot_user_id,
                incomingWebhook: data.incoming_webhook,
            },
        };
    }

    public async refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
        const clientId = this.getClientId();
        const clientSecret = this.getClientSecret();

        if (!clientId || !clientSecret) {
            throw new Error("Slack OAuth credentials not configured for refresh.");
        }

        const params = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "refresh_token",
            refresh_token: refreshToken,
        });

        const res = await fetch(this.config.tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
        });

        if (!res.ok) {
            const errText = await res.text();
            logger.error("Failed to refresh Slack token", { error: errText });
            if (res.status === 400 || res.status === 401) {
                throw new OAuthReauthorizationRequiredError(this.platform, 'refresh_rejected',
                    `Slack token refresh failed with status ${res.status}. Reconnect Slack.`);
            }
            throw new Error(`Slack token refresh failed with status ${res.status}: ${errText}`);
        }

        const data = await res.json();
        if (!data.ok) {
            if (['invalid_refresh_token', 'invalid_auth', 'token_revoked', 'account_inactive'].includes(String(data.error))) {
                throw new OAuthReauthorizationRequiredError(this.platform, 'refresh_rejected',
                    `Slack rejected the saved authorization. Reconnect Slack.`);
            }
            throw new Error(`Slack OAuth refresh error: ${data.error}`);
        }

        const expiresInSec = typeof data.expires_in === "number" ? data.expires_in : undefined;

        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || refreshToken,
            tokenType: data.token_type || "Bearer",
            expiresAt: expiresInSec ? new Date(Date.now() + expiresInSec * 1000) : null,
            scopes: data.scope ? data.scope.split(",") : undefined,
            rawPayload: data,
        };
    }

    protected async onTokensPersisted(connectorId: number, tokens: OAuthTokens, _payload: OAuthStatePayload): Promise<void> {
        const teamInfo = tokens.rawPayload?.team;
        if (teamInfo) {
            const [connector] = await db.select().from(saasConnectors).where(eq(saasConnectors.id, connectorId)).limit(1);
            if (connector) {
                await db.update(saasConnectors)
                    .set({
                        config: {
                            ...(connector.config || {}),
                            teamId: teamInfo.id,
                            teamName: teamInfo.name,
                            botUserId: tokens.rawPayload?.botUserId,
                        },
                    })
                    .where(eq(saasConnectors.id, connectorId));
            }
        }
    }
}

export const slackOAuthAdapter = new SlackOAuthAdapter();
