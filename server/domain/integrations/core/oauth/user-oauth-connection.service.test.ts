import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ retrieve: vi.fn(), store: vi.fn(), delete: vi.fn(), connection: null as any, updateSet: vi.fn() }));
vi.mock('@domain/auth/core/encrypted-credentials.service.js', () => ({ encryptedCredentialsService: { retrieve: mocks.retrieve, store: mocks.store, delete: mocks.delete } }));
vi.mock('@server/database_service.js', () => ({ db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.connection ? [mocks.connection] : [] }) }) }),
    update: () => ({ set: (values: any) => { mocks.updateSet(values); return { where: async () => undefined }; } }),
} }));
import { UserOAuthConnectionService } from './user-oauth-connection.service.js';
import { OAuthReauthorizationRequiredError, isReauthorizationRequired } from './reauthorization.js';

const connection = { id: 4, orgId: 22, userId: 'user-a', platform: 'granola', status: 'connected', config: {}, credentialId: 8, lastSyncAt: null, createdAt: new Date(), updatedAt: new Date() };

describe('UserOAuthConnectionService', () => {
    beforeEach(() => { vi.clearAllMocks(); mocks.connection = connection; mocks.delete.mockResolvedValue(true); });

    it('always reads credentials through the owning organization', async () => {
        mocks.retrieve.mockResolvedValue({ accessToken: 'token' });
        await new UserOAuthConnectionService('granola').credentials(connection);
        expect(mocks.retrieve).toHaveBeenCalledWith(22, 'user_connection', 4, 'granola_oauth_token');
    });

    it('requires both organization and user when resolving a connection', async () => {
        const service = new UserOAuthConnectionService('granola');
        await service.get(4, { organizationId: 22, userId: 'user-a' });
        expect(mocks.connection).toBe(connection);
    });

    it('refreshes an expiring token once and retains a rotated refresh token', async () => {
        mocks.retrieve.mockResolvedValue({ accessToken: 'old', refreshToken: 'refresh', expiresAt: new Date(Date.now() - 1000).toISOString() });
        mocks.store.mockResolvedValue({ id: 8 });
        const refresh = vi.fn().mockResolvedValue({ accessToken: 'new', refreshToken: 'rotated', expiresAt: new Date(Date.now() + 3600000), scopes: ['mcp'] });
        const service = new UserOAuthConnectionService('granola');
        expect(await service.validAccessToken(connection, refresh)).toBe('new');
        expect(refresh).toHaveBeenCalledWith('refresh', connection);
        expect(mocks.store).toHaveBeenCalledWith(22, 'user_connection', 4, 'granola_oauth_token', expect.objectContaining({ accessToken: 'new', refreshToken: 'rotated' }));
    });

    it('flags credentials_missing when no access token is stored', async () => {
        mocks.retrieve.mockResolvedValue({ refreshToken: 'r' });
        const service = new UserOAuthConnectionService('granola');
        const err = await service.validAccessToken(connection, vi.fn()).catch((e: unknown) => e);
        expect(isReauthorizationRequired(err)).toBe(true);
        expect((err as OAuthReauthorizationRequiredError).reason).toBe('credentials_missing');
        expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'error',
            config: expect.objectContaining({ reauth_required: true, reauth_reason: 'credentials_missing' }),
        }));
    });

    it('flags no_refresh_token when an expiring token cannot be renewed', async () => {
        mocks.retrieve.mockResolvedValue({ accessToken: 'old', expiresAt: new Date(Date.now() - 1000).toISOString(), scopes: ['mcp'] });
        const service = new UserOAuthConnectionService('granola');
        const err = await service.validAccessToken(connection, vi.fn()).catch((e: unknown) => e);
        expect(isReauthorizationRequired(err)).toBe(true);
        expect((err as OAuthReauthorizationRequiredError).reason).toBe('no_refresh_token');
        expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'error',
            config: expect.objectContaining({ reauth_required: true, reauth_reason: 'no_refresh_token' }),
        }));
    });

    it('flags and rethrows a provider refresh rejection', async () => {
        mocks.retrieve.mockResolvedValue({ accessToken: 'old', refreshToken: 'r', expiresAt: new Date(Date.now() - 1000).toISOString() });
        const refresh = vi.fn().mockRejectedValue(new OAuthReauthorizationRequiredError('granola', 'refresh_rejected'));
        const service = new UserOAuthConnectionService('granola');
        const err = await service.validAccessToken(connection, refresh).catch((e: unknown) => e);
        expect(isReauthorizationRequired(err)).toBe(true);
        expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'error',
            config: expect.objectContaining({ reauth_required: true, reauth_reason: 'refresh_rejected' }),
        }));
    });

    it('does not flag the connection for a transient refresh failure', async () => {
        mocks.retrieve.mockResolvedValue({ accessToken: 'old', refreshToken: 'r', expiresAt: new Date(Date.now() - 1000).toISOString() });
        const refresh = vi.fn().mockRejectedValue(new Error('provider returned 503'));
        const service = new UserOAuthConnectionService('granola');
        const err = await service.validAccessToken(connection, refresh).catch((e: unknown) => e);
        expect(isReauthorizationRequired(err)).toBe(false);
        expect(mocks.updateSet).not.toHaveBeenCalled();
    });

    it('deletes credentials with organization scope before disconnecting', async () => {
        await new UserOAuthConnectionService('granola').disconnect(connection);
        expect(mocks.delete).toHaveBeenCalledWith(22, 'user_connection', 4, 'granola_oauth_token');
        expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'disconnected', credentialId: null }));
    });
});
