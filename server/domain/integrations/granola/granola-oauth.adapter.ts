import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { BaseOAuthAdapter } from '../core/oauth/base-oauth.adapter.js';
import { OAuthReauthorizationRequiredError } from '../core/oauth/reauthorization.js';
import type { HandleCallbackOptions, InitiateOAuthOptions, OAuthProviderConfig, OAuthTokens } from '../core/oauth/oauth-adapter.types.js';
import { UserOAuthConnectionService } from '../core/oauth/user-oauth-connection.service.js';
import { redis } from '@domain/core/infrastructure/redis/redis-client.js';

const DEFAULT_ISSUER = 'https://mcp-auth.granola.ai';
const DEFAULT_RESOURCE = 'https://mcp.granola.ai/mcp';
const scopes = ['mcp', 'offline_access'];
export const granolaUserConnections = new UserOAuthConnectionService('granola');

function issuer() { return (process.env.GRANOLA_OAUTH_ISSUER || DEFAULT_ISSUER).replace(/\/$/, ''); }
export function granolaMcpUrl() { return process.env.GRANOLA_MCP_URL || DEFAULT_RESOURCE; }

export class GranolaOAuthAdapter extends BaseOAuthAdapter {
    readonly platform = 'granola';
    readonly callbackPath = '/api/me/connections/granola/oauth/callback';
    readonly config: OAuthProviderConfig = {
        platform: 'granola', authorizeUrl: `${issuer()}/oauth2/authorize`, tokenUrl: `${issuer()}/oauth2/token`,
        defaultScopes: scopes, usePkce: true, supportsOfflineAccess: false,
    };

    protected getClientId() { return process.env.GRANOLA_CLIENT_ID || process.env.GRANOLA_CLIENT_METADATA_URL || ''; }
    protected getClientSecret() { return ''; }

    private async clientIdFor(redirectUri: string) {
        const configured = this.getClientId();
        if (configured) return configured;
        const key = `granola:dcr:${createHash('sha256').update(redirectUri).digest('hex')}`;
        const cached = await redis.get(key).catch(() => null);
        if (cached) return cached;
        const response = await fetch(`${issuer()}/oauth2/register`, {
            method: 'POST', signal: AbortSignal.timeout(30_000),
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ client_name: 'Oddjob', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
        });
        if (!response.ok) throw new Error(`Granola client registration failed (${response.status}).`);
        const data = await response.json() as { client_id?: string };
        if (!data.client_id) throw new Error('Granola client registration returned no client_id.');
        await redis.set(key, data.client_id).catch(() => undefined);
        return data.client_id;
    }

    override async getAuthorizationUrl(options: InitiateOAuthOptions) {
        const redirectUri = this.resolveRedirectUri(options.req, options.customRedirectUri);
        const clientId = await this.clientIdFor(redirectUri);
        const result = await super.getAuthorizationUrl({ ...options, scopes, extraState: { ...options.extraState, clientId } });
        const url = new URL(result.url);
        url.searchParams.set('client_id', clientId);
        url.searchParams.set('resource', granolaMcpUrl());
        return { ...result, url: url.toString() };
    }

    private async tokenRequest(params: URLSearchParams, clientId: string): Promise<OAuthTokens> {
        params.set('client_id', clientId);
        params.set('resource', granolaMcpUrl());
        const response = await fetch(`${issuer()}/oauth2/token`, {
            method: 'POST', signal: AbortSignal.timeout(30_000),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: params.toString(),
        });
        if (!response.ok) {
            if (response.status === 400 || response.status === 401) {
                throw new OAuthReauthorizationRequiredError(this.platform, 'refresh_rejected',
                    `Granola token request failed (${response.status}). Reconnect Granola.`);
            }
            throw new Error(`Granola token request failed (${response.status}). Reconnect Granola.`);
        }
        const data = await response.json() as Record<string, any>;
        if (typeof data.access_token !== 'string' || !data.access_token) throw new Error('Granola returned an invalid token response.');
        return { accessToken: data.access_token, refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
            tokenType: data.token_type || 'Bearer', expiresAt: Number(data.expires_in) > 0 ? new Date(Date.now() + Number(data.expires_in) * 1000) : null,
            scopes: typeof data.scope === 'string' ? data.scope.split(/\s+/) : scopes, rawPayload: data };
    }

    async exchangeCodeForTokens(code: string, redirectUri: string, codeVerifier?: string, clientId = this.getClientId()) {
        return this.tokenRequest(new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, ...(codeVerifier ? { code_verifier: codeVerifier } : {}) }), clientId);
    }

    async refreshAccessToken(refreshToken: string, clientId = this.getClientId()) {
        return this.tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }), clientId);
    }

    override async handleCallback(options: HandleCallbackOptions) {
        const state = await this.consumeState(options.stateId);
        if (!state) throw new Error('Invalid or expired Granola OAuth state.');
        await options.validateState?.(state);
        const userId = String(state.extra?.userId || '');
        const clientId = String(state.extra?.clientId || '');
        if (!userId || !clientId) throw new Error('Granola OAuth state is incomplete.');
        const tokens = await this.exchangeCodeForTokens(options.code, state.redirectUri, state.codeVerifier, clientId);
        const connection = await granolaUserConnections.connect({ organizationId: state.organizationId, userId, tokens, config: { oauthClientId: clientId } });
        return { connectorId: connection.id, organizationId: state.organizationId, platform: this.platform, tokens, returnTo: state.returnTo };
    }

    override async getValidAccessToken(connectionId: number, organizationId?: number, userId?: string) {
        if (!organizationId || !userId) throw new Error('Granola token access requires organization and user scope.');
        const connection = await granolaUserConnections.get(connectionId, { organizationId, userId });
        if (!connection) throw new Error('Granola is not connected for this user.');
        return granolaUserConnections.validAccessToken(connection, async (refreshToken, current) => {
            const clientId = String((current.config as Record<string, any>).oauthClientId || this.getClientId());
            return this.refreshAccessToken(refreshToken, clientId);
        });
    }

    override async disconnect(connectionId: number, organizationId?: number, userId?: string) {
        if (!organizationId || !userId) throw new Error('Granola disconnect requires organization and user scope.');
        const connection = await granolaUserConnections.get(connectionId, { organizationId, userId });
        if (connection) await granolaUserConnections.disconnect(connection);
    }
}

export const granolaOAuthAdapter = new GranolaOAuthAdapter();
