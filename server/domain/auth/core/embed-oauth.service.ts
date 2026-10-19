/**
 * Embed OAuth Service
 * Handles OAuth 2 authorization code flow for embedded agent authentication.
 * State is stored in-memory (5 min TTL). For production, use Redis.
 */

import { randomBytes } from 'crypto';
import { readCredentialSecret } from "@server/utils/credential-secret.js";

const STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const EMBED_OAUTH_COOKIE = 'oddjob_embed_oauth';

interface StateEntry {
    slug: string;
    deploymentId: number;
    organizationId: number;
    createdAt: number;
}

const stateStore = new Map<string, StateEntry>();

function cleanupExpired() {
    const now = Date.now();
    for (const [state, entry] of stateStore.entries()) {
        if (now - entry.createdAt > STATE_TTL_MS) stateStore.delete(state);
    }
}

export function createOAuthState(slug: string, deploymentId: number, organizationId: number): string {
    cleanupExpired();
    const state = randomBytes(24).toString('base64url');
    stateStore.set(state, { slug, deploymentId, organizationId, createdAt: Date.now() });
    return state;
}

export function consumeOAuthState(state: string): StateEntry | null {
    const entry = stateStore.get(state);
    stateStore.delete(state);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > STATE_TTL_MS) return null;
    return entry;
}

export interface EmbedOAuthConfig {
    embedOAuthEnabled?: boolean;
    embedOAuthClientId?: string;
    embedOAuthClientSecretRef?: string;
    embedOAuthAuthUrl?: string;
    embedOAuthTokenUrl?: string;
    embedOAuthScopes?: string[];
    embedOAuthRedirectUri?: string;
}

export function getAuthorizationUrl(config: EmbedOAuthConfig, state: string): string | null {
    if (!config.embedOAuthEnabled || !config.embedOAuthClientId || !config.embedOAuthAuthUrl) return null;
    const scopes = (config.embedOAuthScopes ?? ['openid']).join(' ');
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: config.embedOAuthClientId,
        redirect_uri: config.embedOAuthRedirectUri || '',
        scope: scopes,
        state,
    });
    return `${config.embedOAuthAuthUrl}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
    config: EmbedOAuthConfig,
    code: string,
    redirectUri: string
): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number } | null> {
    if (!config.embedOAuthTokenUrl || !config.embedOAuthClientId) return null;
    const clientSecret = config.embedOAuthClientSecretRef
        // The ref and the token URL are both org-configured: a raw env read
        // would post any platform secret to a URL of the org's choosing.
        ? readCredentialSecret(config.embedOAuthClientSecretRef)
        : undefined;
    if (!clientSecret) return null;

    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: config.embedOAuthClientId,
        client_secret: clientSecret,
    });

    const res = await fetch(config.embedOAuthTokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    return {
        accessToken: data.access_token || '',
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
    };
}

export function getEmbedOAuthCookieName(): string {
    return EMBED_OAUTH_COOKIE;
}

export function buildEmbedOAuthCookie(accessToken: string, maxAgeSeconds: number): string {
    return `${EMBED_OAUTH_COOKIE}=${accessToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function getEmbedOAuthTokenFromCookie(cookieHeader: string | undefined): string | null {
    if (!cookieHeader) return null;
    const match = cookieHeader.match(new RegExp(`${EMBED_OAUTH_COOKIE}=([^;]+)`));
    return match ? decodeURIComponent(match[1]) : null;
}


