/**
 * Microsoft 365 OAuth 2.0 Adapter
 *
 * Microsoft identity platform (Entra ID) authorization code flow for OneDrive,
 * SharePoint and Office document access. PKCE is enabled — Entra supports S256
 * and it costs nothing. `offline_access` is what earns the refresh token.
 *
 * Requires MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET, and optionally
 * MICROSOFT_TENANT_ID (defaults to "common" so any work/school tenant can sign
 * in; pin it to a tenant id or "organizations" when the app registration is
 * single-tenant).
 */

import { BaseOAuthAdapter } from "./base-oauth.adapter.js";
import { OAuthReauthorizationRequiredError } from "./reauthorization.js";
import type { OAuthProviderConfig, OAuthTokens } from "./oauth-adapter.types.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("MicrosoftOAuthAdapter");

function tenantBase(): string {
    const tenant = process.env.MICROSOFT_TENANT_ID || "common";
    return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
}

export class MicrosoftOAuthAdapter extends BaseOAuthAdapter {
    readonly platform = "microsoft365";
    readonly callbackPath = "/api/saas/connectors/microsoft/oauth/callback";

    readonly config: OAuthProviderConfig = {
        platform: "microsoft365",
        authorizeUrl: `${tenantBase()}/authorize`,
        tokenUrl: `${tenantBase()}/token`,
        defaultScopes: [
            "openid",
            "profile",
            "offline_access",
            "User.Read",
            "Files.ReadWrite.All",
            "Sites.ReadWrite.All",
        ],
        usePkce: true,
        supportsOfflineAccess: false,
    };

    protected getClientId(): string {
        return process.env.MICROSOFT_CLIENT_ID || "";
    }

    protected getClientSecret(): string {
        return process.env.MICROSOFT_CLIENT_SECRET || "";
    }

    private async postTokenForm(body: URLSearchParams): Promise<OAuthTokens> {
        const res = await fetch(this.config.tokenUrl, {
            method: "POST",
            // Entra rejects JSON token requests — form encoding is mandatory.
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
        });

        if (!res.ok) {
            const errText = await res.text();
            logger.error("Microsoft token endpoint failed", { status: res.status, error: errText });
            if ((res.status === 400 || res.status === 401) && body.get('grant_type') === 'refresh_token') {
                throw new OAuthReauthorizationRequiredError(this.platform, 'refresh_rejected',
                    `Microsoft token refresh failed with status ${res.status}. Reconnect Microsoft 365.`);
            }
            throw new Error(`Microsoft token exchange failed with status ${res.status}: ${errText}`);
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

    public async exchangeCodeForTokens(
        code: string,
        redirectUri: string,
        codeVerifier?: string
    ): Promise<OAuthTokens> {
        const clientId = this.getClientId();
        const clientSecret = this.getClientSecret();
        if (!clientId || !clientSecret) {
            throw new Error("Microsoft 365 OAuth not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET.");
        }

        const body = new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
        });
        if (codeVerifier) body.set("code_verifier", codeVerifier);

        return this.postTokenForm(body);
    }

    public async refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
        const clientId = this.getClientId();
        const clientSecret = this.getClientSecret();
        if (!clientId || !clientSecret) {
            throw new Error("Microsoft 365 OAuth credentials not configured for refresh.");
        }

        return this.postTokenForm(new URLSearchParams({
            grant_type: "refresh_token",
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
        }));
    }

    protected async fetchUserInfo(accessToken: string): Promise<Record<string, any>> {
        const res = await fetch("https://graph.microsoft.com/v1.0/me", {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
            logger.warn(`Failed to fetch Microsoft /me profile: HTTP ${res.status}`);
            return {};
        }
        const me = await res.json();
        return {
            displayName: me.displayName,
            mail: me.mail ?? me.userPrincipalName,
            tenantUserId: me.id,
        };
    }
}

export const microsoftOAuthAdapter = new MicrosoftOAuthAdapter();
