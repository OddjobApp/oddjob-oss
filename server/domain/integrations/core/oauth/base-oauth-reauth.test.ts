import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    connector: null as any,
    retrieve: vi.fn(),
    store: vi.fn(),
    updateSet: vi.fn(),
}));

vi.mock('@server/database_service.js', () => ({
    db: {
        select: () => ({ from: () => ({ where: () => ({ limit: async () => (mocks.connector ? [mocks.connector] : []) }) }) }),
        update: () => ({ set: (values: any) => { mocks.updateSet(values); return { where: async () => undefined }; } }),
    },
}));
vi.mock('@domain/core/infrastructure/redis/redis-client.js', () => ({ redis: {} }));
vi.mock('@domain/auth/core/encrypted-credentials.service.js', () => ({
    encryptedCredentialsService: { retrieve: mocks.retrieve, store: mocks.store },
}));

import { JiraOAuthAdapter } from './jira-oauth.adapter.js';
import { OAuthReauthorizationRequiredError, isReauthorizationRequired } from './reauthorization.js';

const connector = { id: 7, orgId: 22, platform: 'jira', status: 'connected', projectId: null, config: {}, credentialId: 3 };

function expiringCredential(overrides: Record<string, any> = {}) {
    return {
        accessToken: 'old-access',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        scopes: ['read:jira-work'],
        ...overrides,
    };
}

describe('BaseOAuthAdapter.getValidAccessToken reauthorization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.connector = { ...connector };
        vi.stubEnv('JIRA_CLIENT_ID', 'id');
        vi.stubEnv('JIRA_CLIENT_SECRET', 'secret');
    });

    it('flags the connector and rethrows when the provider rejects the refresh', async () => {
        mocks.retrieve.mockResolvedValue(expiringCredential());
        const adapter = new JiraOAuthAdapter();
        vi.spyOn(adapter, 'refreshAccessToken').mockRejectedValue(
            new OAuthReauthorizationRequiredError('jira', 'refresh_rejected'));

        const err = await adapter.getValidAccessToken(7).catch(e => e);
        expect(isReauthorizationRequired(err)).toBe(true);
        expect(err.reason).toBe('refresh_rejected');
        expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'error',
            config: expect.objectContaining({ reauth_required: true, reauth_reason: 'refresh_rejected', reauth_scopes: ['read:jira-work'] }),
        }));
    });

    it('does not flag the connector for a transient refresh failure', async () => {
        mocks.retrieve.mockResolvedValue(expiringCredential());
        const adapter = new JiraOAuthAdapter();
        vi.spyOn(adapter, 'refreshAccessToken').mockRejectedValue(new Error('provider returned 503'));

        const err = await adapter.getValidAccessToken(7).catch(e => e);
        expect(isReauthorizationRequired(err)).toBe(false);
        expect(err.message).toContain('OAuth token refresh failed for jira');
        expect(mocks.updateSet).not.toHaveBeenCalled();
    });

    it('flags no_refresh_token instead of returning the stale token', async () => {
        mocks.retrieve.mockResolvedValue(expiringCredential({ refreshToken: undefined }));
        const adapter = new JiraOAuthAdapter();
        const refresh = vi.spyOn(adapter, 'refreshAccessToken');

        const err = await adapter.getValidAccessToken(7).catch(e => e);
        expect(isReauthorizationRequired(err)).toBe(true);
        expect(err.reason).toBe('no_refresh_token');
        expect(refresh).not.toHaveBeenCalled();
        expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'error',
            config: expect.objectContaining({ reauth_required: true, reauth_reason: 'no_refresh_token' }),
        }));
    });

    it('keeps using a not-yet-expired token that cannot be refreshed', async () => {
        mocks.retrieve.mockResolvedValue(expiringCredential({
            refreshToken: undefined,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }));
        const adapter = new JiraOAuthAdapter();

        expect(await adapter.getValidAccessToken(7)).toBe('old-access');
        expect(mocks.updateSet).not.toHaveBeenCalled();
    });

    it('returns the token untouched when it has no expiry', async () => {
        mocks.retrieve.mockResolvedValue(expiringCredential({ expiresAt: null }));
        const adapter = new JiraOAuthAdapter();

        expect(await adapter.getValidAccessToken(7)).toBe('old-access');
        expect(mocks.updateSet).not.toHaveBeenCalled();
    });

    it('clears the flag after a successful refresh', async () => {
        mocks.connector = { ...connector, config: { reauth_required: true, reauth_reason: 'refresh_rejected', reauth_at: 'x', reauth_scopes: ['s'], other: 1 } };
        mocks.retrieve.mockResolvedValue(expiringCredential());
        mocks.store.mockResolvedValue({ id: 3 });
        const adapter = new JiraOAuthAdapter();
        vi.spyOn(adapter, 'refreshAccessToken').mockResolvedValue({
            accessToken: 'new-access', refreshToken: 'rotated', tokenType: 'Bearer',
            expiresAt: new Date(Date.now() + 3600_000), rawPayload: {},
        });

        expect(await adapter.getValidAccessToken(7)).toBe('new-access');
        expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'connected',
            config: { other: 1 },
        }));
    });
});
