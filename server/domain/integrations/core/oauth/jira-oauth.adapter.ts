/**
 * Jira / Atlassian OAuth 2.0 (3LO) Adapter
 * 
 * Implements Atlassian OAuth 2.0 Authorization Code flow with offline_access,
 * cloud site discovery (accessible-resources), token refresh, and connector binding.
 */

import { BaseOAuthAdapter } from "./base-oauth.adapter.js";
import { OAuthReauthorizationRequiredError } from "./reauthorization.js";
import type { OAuthProviderConfig, OAuthTokens, OAuthStatePayload } from "./oauth-adapter.types.js";
import { db } from "@server/database_service.js";
import { saasConnectors } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("JiraOAuthAdapter");

export class JiraOAuthAdapter extends BaseOAuthAdapter {
    readonly platform = "jira";
    readonly callbackPath = "/api/saas/connectors/jira/oauth/callback";

    readonly config: OAuthProviderConfig = {
        platform: "jira",
        authorizeUrl: "https://auth.atlassian.com/authorize",
        tokenUrl: "https://auth.atlassian.com/oauth/token",
        defaultScopes: [
            "read:jira-work",
            "manage:jira-project",
            "read:jira-user",
            "write:jira-work",
            "offline_access",
        ],
        usePkce: false,
        supportsOfflineAccess: true,
        additionalAuthParams: {
            audience: "api.atlassian.com",
            prompt: "consent",
        },
    };

    protected getClientId(): string {
        return process.env.JIRA_CLIENT_ID || "";
    }

    protected getClientSecret(): string {
        return process.env.JIRA_CLIENT_SECRET || "";
    }

    public async exchangeCodeForTokens(
        code: string,
        redirectUri: string,
        _codeVerifier?: string
    ): Promise<OAuthTokens> {
        const clientId = this.getClientId();
        const clientSecret = this.getClientSecret();

        if (!clientId || !clientSecret) {
            throw new Error("Jira OAuth credentials not configured. Please set JIRA_CLIENT_ID and JIRA_CLIENT_SECRET.");
        }

        const res = await fetch(this.config.tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                grant_type: "authorization_code",
                client_id: clientId,
                client_secret: clientSecret,
                code,
                redirect_uri: redirectUri,
            }),
        });

        if (!res.ok) {
            const errText = await res.text();
            logger.error("Failed to exchange Atlassian auth code for token", { error: errText });
            throw new Error(`Atlassian token exchange failed with status ${res.status}: ${errText}`);
        }

        const data = await res.json();
        const expiresInSec = typeof data.expires_in === "number" ? data.expires_in : 3600;

        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            tokenType: data.token_type || "Bearer",
            expiresAt: new Date(Date.now() + expiresInSec * 1000),
            scopes: data.scope ? data.scope.split(" ") : this.config.defaultScopes,
            rawPayload: data,
        };
    }

    public async refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
        const clientId = this.getClientId();
        const clientSecret = this.getClientSecret();

        if (!clientId || !clientSecret) {
            throw new Error("Jira OAuth credentials not configured for refresh.");
        }

        const res = await fetch(this.config.tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                grant_type: "refresh_token",
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken,
            }),
        });

        if (!res.ok) {
            const errText = await res.text();
            logger.error("Failed to refresh Atlassian token", { error: errText });
            if (res.status === 400 || res.status === 401) {
                throw new OAuthReauthorizationRequiredError(this.platform, 'refresh_rejected',
                    `Atlassian token refresh failed with status ${res.status}. Reconnect Jira.`);
            }
            throw new Error(`Atlassian token refresh failed with status ${res.status}: ${errText}`);
        }

        const data = await res.json();
        const expiresInSec = typeof data.expires_in === "number" ? data.expires_in : 3600;

        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || refreshToken,
            tokenType: data.token_type || "Bearer",
            expiresAt: new Date(Date.now() + expiresInSec * 1000),
            scopes: data.scope ? data.scope.split(" ") : undefined,
            rawPayload: data,
        };
    }

    protected async fetchUserInfo(accessToken: string): Promise<Record<string, any>> {
        // Query accessible Atlassian Cloud sites / resources
        const res = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
            },
        });

        if (!res.ok) {
            logger.warn(`Failed to fetch Atlassian accessible resources: HTTP ${res.status}`);
            return {};
        }

        const resources = await res.json();
        if (Array.isArray(resources) && resources.length > 0) {
            const primary = resources[0];
            return {
                cloudId: primary.id,
                siteName: primary.name,
                siteUrl: primary.url,
                scopes: primary.scopes,
                availableSites: resources,
            };
        }

        return { availableSites: resources };
    }

    protected async onTokensPersisted(connectorId: number, _tokens: OAuthTokens, _payload: OAuthStatePayload): Promise<void> {
        // Automatically sync Jira cloud site base URL if available
        const [connector] = await db.select().from(saasConnectors).where(eq(saasConnectors.id, connectorId)).limit(1);
        if (connector && connector.config && (connector.config as any).userInfo?.siteUrl && !connector.baseUrl) {
            await db.update(saasConnectors)
                .set({ baseUrl: (connector.config as any).userInfo.siteUrl })
                .where(eq(saasConnectors.id, connectorId));
        }
    }
}

export const jiraOAuthAdapter = new JiraOAuthAdapter();
