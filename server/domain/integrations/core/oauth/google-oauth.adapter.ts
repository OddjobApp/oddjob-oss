import { currentOAuthApp } from './org-oauth-app.service.js';
/**
 * Google OAuth 2.0 Adapter
 * 
 * Handles Google OAuth 2.0 authorization code flow for Gmail, Google Drive, and Google Workspace integrations.
 * Supports offline consent (refresh token issuance), token refresh, and user profile resolution.
 */

import { BaseOAuthAdapter } from "./base-oauth.adapter.js";
import { OAuthReauthorizationRequiredError } from "./reauthorization.js";
import type { OAuthProviderConfig, OAuthTokens } from "./oauth-adapter.types.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("GoogleOAuthAdapter");

export class GoogleOAuthAdapter extends BaseOAuthAdapter {
    public isConfigured(): boolean {
        return Boolean(this.getClientId() && this.getClientSecret());
    }
    readonly platform = "google";
    readonly callbackPath = "/api/gmail/oauth/callback";

    readonly config: OAuthProviderConfig = {
        platform: "google",
        authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        revokeUrl: "https://oauth2.googleapis.com/revoke",
        defaultScopes: [
            "https://www.googleapis.com/auth/gmail.send",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/userinfo.profile",
        ],
        usePkce: false,
        supportsOfflineAccess: true,
        additionalAuthParams: {
            access_type: "offline",
            prompt: "consent",
            include_granted_scopes: "true",
        },
    };

    protected getClientId(): string {
        return currentOAuthApp()?.clientId ?? (process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "");
    }

    protected getClientSecret(): string {
        return currentOAuthApp()?.clientSecret ?? (process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "");
    }

    public async exchangeCodeForTokens(
        code: string,
        redirectUri: string,
        _codeVerifier?: string
    ): Promise<OAuthTokens> {
        const clientId = this.getClientId();
        const clientSecret = this.getClientSecret();

        if (!clientId || !clientSecret) {
            throw new Error("Google OAuth credentials not configured. Set GMAIL_CLIENT_ID / GOOGLE_CLIENT_ID and secret.");
        }

        const params = new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
        });

        const res = await fetch(this.config.tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
        });

        if (!res.ok) {
            logger.error("Failed to exchange Google auth code for token", { status: res.status });
            throw new Error(`Google token exchange failed with status ${res.status}`);
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
            throw new Error("Google OAuth credentials not configured for refresh.");
        }

        const params = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
        });

        const res = await fetch(this.config.tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
        });

        if (!res.ok) {
            logger.error("Failed to refresh Google access token", { status: res.status });
            if (res.status === 400 || res.status === 401) {
                throw new OAuthReauthorizationRequiredError(this.platform, 'refresh_rejected',
                    `Google token refresh failed with status ${res.status}. Reconnect Google.`);
            }
            throw new Error(`Google token refresh failed with status ${res.status}`);
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
        const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        if (!res.ok) {
            logger.warn(`Failed to fetch Google user profile: HTTP ${res.status}`);
            return {};
        }

        const profile = await res.json();
        return {
            email: profile.email,
            name: profile.name,
            picture: profile.picture,
            verifiedEmail: profile.verified_email,
        };
    }
}

export const googleOAuthAdapter = new GoogleOAuthAdapter();
