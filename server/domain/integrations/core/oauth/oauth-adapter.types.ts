/**
 * OAuth Adapter Framework — Type Definitions
 * 
 * Standard contracts for multi-tenant OAuth 2.0 authorization flows,
 * dynamic redirect URI generation (Cloudflare tunnels / localhost / custom domains),
 * PKCE verification, token storage, and automatic token refresh.
 */

import type { Request } from "express";

export interface OAuthProviderConfig {
    platform: string;
    authorizeUrl: string;
    tokenUrl: string;
    revokeUrl?: string;
    defaultScopes: string[];
    usePkce?: boolean;
    supportsOfflineAccess?: boolean;
    additionalAuthParams?: Record<string, string>;
}

export interface OAuthStatePayload {
    stateId: string;
    organizationId: number;
    projectId?: number | null;
    platform: string;
    redirectUri: string;
    codeVerifier?: string;
    returnTo?: string;
    createdAt: number;
    extra?: Record<string, any>;
}

export interface OAuthTokens {
    accessToken: string;
    refreshToken?: string;
    tokenType?: string;
    expiresAt?: Date | null;
    scopes?: string[];
    rawPayload?: Record<string, any>;
}

export interface InitiateOAuthOptions {
    organizationId: number;
    projectId?: number | null;
    req?: Request;
    scopes?: string[];
    returnTo?: string;
    customRedirectUri?: string;
    extraState?: Record<string, any>;
}

export interface HandleCallbackOptions {
    code: string;
    stateId: string;
    req?: Request;
    /** Adapter-only validation/enrichment after single-use state consumption. */
    validateState?: (payload: OAuthStatePayload) => void | Promise<void>;
}

export interface OAuthCallbackResult {
    connectorId?: number;
    organizationId: number;
    projectId?: number | null;
    platform: string;
    tokens: OAuthTokens;
    returnTo?: string;
    userInfo?: Record<string, any>;
}

export interface OAuthAdapter {
    readonly platform: string;
    readonly config: OAuthProviderConfig;

    /**
     * Generates authorization URL, registers CSRF/PKCE state in Redis,
     * and handles dynamic redirect URI resolution (supporting Cloudflare tunnels).
     */
    getAuthorizationUrl(options: InitiateOAuthOptions): Promise<{ url: string; stateId: string; redirectUri: string }>;

    /**
     * Verifies state, exchanges authorization code for tokens, and persists encrypted credentials.
     */
    handleCallback(options: HandleCallbackOptions): Promise<OAuthCallbackResult>;

    /**
     * Resolves a valid access token for a connector, automatically refreshing if nearing expiration.
     */
    getValidAccessToken(connectorId: number): Promise<string>;

    /**
     * Refreshes an expired or expiring access token using a refresh token.
     */
    refreshAccessToken(refreshToken: string): Promise<OAuthTokens>;

    /**
     * Revokes access and disconnects the connector.
     */
    disconnect(connectorId: number): Promise<void>;
}
