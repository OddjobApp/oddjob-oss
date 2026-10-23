import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  state: new Map<string, string>(), app: { clientId: 'org-app', clientSecret: 'org-secret' },
  connector: { id: 8, orgId: 19, platform: 'google', status: 'connected', config: {} },
  retrieve: vi.fn(), store: vi.fn(), fetch: vi.fn(), update: vi.fn(),
}));
vi.mock('@server/database_service.js', () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [mocks.connector] }) }) }),
  update: () => ({ set: (value: unknown) => { mocks.update(value); return { where: async () => undefined }; } }),
} }));
vi.mock('@domain/core/infrastructure/redis/redis-client.js', () => ({ redis: {
  setex: async (key: string, _ttl: number, value: string) => mocks.state.set(key, value),
  get: async (key: string) => mocks.state.get(key), del: async (key: string) => mocks.state.delete(key),
} }));
vi.mock('@domain/auth/core/encrypted-credentials.service.js', () => ({ encryptedCredentialsService: {
  retrieve: mocks.retrieve, store: mocks.store, exists: async () => false,
} }));
import { GoogleOAuthAdapter } from './google-oauth.adapter.js';
import { oauthAppFingerprint } from './org-oauth-app.service.js';
beforeEach(() => {
  vi.clearAllMocks(); mocks.state.clear(); mocks.app = { clientId: 'org-app', clientSecret: 'org-secret' };
  mocks.retrieve.mockImplementation(async (_org: number, type: string) => type === 'organization_oauth_app' ? mocks.app : {
    accessToken: 'expired', refreshToken: 'refresh', expiresAt: new Date(0).toISOString(), oauthAppFingerprint: oauthAppFingerprint(mocks.app),
  });
  mocks.store.mockResolvedValue({ id: 2 });
});
describe('organization credentials through real OAuth adapter entry points', () => {
  it('uses the org client for consent and refuses a callback after credentials rotate', async () => {
    const adapter = new GoogleOAuthAdapter();
    const authorization = await adapter.getAuthorizationUrl({ organizationId: 19 });
    expect(new URL(authorization.url).searchParams.get('client_id')).toBe('org-app');
    mocks.app = { clientId: 'replacement', clientSecret: 'replacement-secret' };
    const exchange = vi.spyOn(adapter, 'exchangeCodeForTokens');
    await expect(adapter.handleCallback({ code: 'code', stateId: authorization.stateId })).rejects.toThrow('settings changed');
    expect(exchange).not.toHaveBeenCalled(); expect(mocks.store).not.toHaveBeenCalled();
  });
  it('refreshes with the connector organization’s app, never another org’s or the platform app', async () => {
    const adapter = new GoogleOAuthAdapter();
    const refresh = vi.spyOn(adapter, 'refreshAccessToken').mockImplementation(async () => {
      expect((adapter as any).getClientId()).toBe('org-app');
      expect((adapter as any).getClientSecret()).toBe('org-secret');
      return { accessToken: 'renewed' };
    });
    expect(await adapter.getValidAccessToken(8)).toBe('renewed');
    expect(refresh).toHaveBeenCalledWith('refresh');
    expect(mocks.retrieve).toHaveBeenCalledWith(19, 'organization_oauth_app', 19, 'google');
  });
  it('requires reconnect instead of refreshing a token with a replacement app', async () => {
    mocks.retrieve.mockImplementation(async (_org: number, type: string) => type === 'organization_oauth_app' ? mocks.app : {
      accessToken: 'expired', refreshToken: 'refresh', expiresAt: new Date(0).toISOString(), oauthAppFingerprint: 'previous-app',
    });
    const adapter = new GoogleOAuthAdapter();
    const refresh = vi.spyOn(adapter, 'refreshAccessToken');
    await expect(adapter.getValidAccessToken(8)).rejects.toThrow('settings changed');
    expect(refresh).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });
});
