import { currentOAuthApp, resolveOAuthApp, withOrgOAuthApp } from './org-oauth-app.service.js';
import { BaseOAuthAdapter } from './base-oauth.adapter.js';
import { OAuthReauthorizationRequiredError } from './reauthorization.js';
import type { HandleCallbackOptions, InitiateOAuthOptions, OAuthProviderConfig, OAuthTokens } from './oauth-adapter.types.js';
import { getUserOrgContext, requireOrgId } from '@server/utils/auth-context.js';
import { ForbiddenError } from '@server/utils/errors.js';
import { db } from '@server/database_service.js';
import { saasConnectors } from '@shared/schema/index.js';
import { eq } from 'drizzle-orm';

export function quickBooksEnvironment(): 'sandbox' | 'production' {
    const value = currentOAuthApp()?.environment ?? process.env.QUICKBOOKS_ENVIRONMENT ?? 'sandbox';
    if (value !== 'sandbox' && value !== 'production') throw new Error('QUICKBOOKS_ENVIRONMENT must be sandbox or production.');
    return value;
}

export class QuickBooksOAuthAdapter extends BaseOAuthAdapter {
    readonly platform = 'quickbooks';
    readonly callbackPath = '/api/saas/connectors/quickbooks/oauth/callback';
    readonly config: OAuthProviderConfig = {
        platform: 'quickbooks', authorizeUrl: 'https://appcenter.intuit.com/connect/oauth2',
        tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
        revokeUrl: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
        defaultScopes: ['com.intuit.quickbooks.accounting'], usePkce: false,
    };
    protected getClientId() { return currentOAuthApp()?.clientId ?? process.env.QUICKBOOKS_CLIENT_ID ?? ''; }
    protected getClientSecret() { return currentOAuthApp()?.clientSecret ?? process.env.QUICKBOOKS_CLIENT_SECRET ?? ''; }
    isConfigured() { return Boolean(this.getClientId() && this.getClientSecret()); }

    override async getAuthorizationUrl(options: InitiateOAuthOptions) {
        return withOrgOAuthApp(options.organizationId, this.platform, async () => {
            if (!this.isConfigured()) throw new Error('Configure the organization’s QuickBooks OAuth app first.');
            return super.getAuthorizationUrl({ ...options, scopes: this.config.defaultScopes,
                extraState: { ...options.extraState, environment: quickBooksEnvironment() } });
        });
    }

    override async handleCallback(options: HandleCallbackOptions) {
        const realmId = options.req?.query.realmId;
        if (typeof realmId !== 'string' || !/^\d{1,30}$/.test(realmId)) throw new Error('QuickBooks did not return a valid company realmId.');
        if (!options.req) throw new Error('An authenticated callback request is required.');
        const caller = await getUserOrgContext(options.req);
        return super.handleCallback({ ...options, validateState: async state => {
            const sameUser = String(state.extra?.userId ?? '') === String(caller.userId);
            const canManageStateOrg = caller.isSuperAdmin || (caller.isOrgAdmin && state.organizationId === requireOrgId(caller));
            if (!sameUser || !canManageStateOrg) throw new ForbiddenError('QuickBooks OAuth state belongs to a different user or organization.');
            if (state.extra?.environment !== (await resolveOAuthApp(state.organizationId, 'quickbooks')).environment) throw new Error('QuickBooks environment changed during sign-in. Start again.');
            state.extra = { ...state.extra, realmId, enabled: true, lastCdcAt: null };
        } });
    }

    private async tokenRequest(body: URLSearchParams): Promise<OAuthTokens> {
        if (!this.isConfigured()) throw new Error('QuickBooks OAuth is not configured.');
        const response = await fetch(this.config.tokenUrl, {
            method: 'POST', signal: AbortSignal.timeout(30_000),
            headers: { Authorization: `Basic ${Buffer.from(`${this.getClientId()}:${this.getClientSecret()}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: body.toString(),
        });
        if (!response.ok) {
            if (response.status === 400 || response.status === 401) {
                throw new OAuthReauthorizationRequiredError(this.platform, 'refresh_rejected',
                    `QuickBooks token request failed (${response.status}). Reconnect if authorization expired.`);
            }
            throw new Error(`QuickBooks token request failed (${response.status}). Reconnect if authorization expired.`);
        }
        const data = await response.json();
        if (typeof data.access_token !== 'string' || !data.access_token || typeof data.refresh_token !== 'string' || !data.refresh_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error('QuickBooks returned an invalid token response.');
        return { accessToken: data.access_token, refreshToken: data.refresh_token, tokenType: data.token_type ?? 'Bearer', expiresAt: new Date(Date.now() + data.expires_in * 1000), scopes: this.config.defaultScopes };
    }
    async exchangeCodeForTokens(code: string, redirectUri: string) {
        return this.tokenRequest(new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }));
    }
    async refreshAccessToken(refreshToken: string) {
        return this.tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }));
    }
    private readonly tokenRequests = new Map<number, Promise<string>>();
    override async getValidAccessToken(connectorId: number) {
        const pending = this.tokenRequests.get(connectorId);
        if (pending) return pending;
        const operation = (async () => {
            const [connector] = await db.select().from(saasConnectors).where(eq(saasConnectors.id, connectorId)).limit(1);
            if (connector?.platform !== this.platform || connector.status !== 'connected') throw new Error('QuickBooks is not connected.');
            if ((connector.config as any)?.environment !== (await resolveOAuthApp(connector.orgId, 'quickbooks')).environment) throw new Error('Reconnect QuickBooks using the configured environment.');
            return super.getValidAccessToken(connectorId);
        })();
        this.tokenRequests.set(connectorId, operation);
        try { return await operation; } finally { this.tokenRequests.delete(connectorId); }
    }

}
export const quickBooksOAuthAdapter = new QuickBooksOAuthAdapter();
