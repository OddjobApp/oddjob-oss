import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), setex: vi.fn(), fetch: vi.fn() }));
vi.mock('@domain/core/infrastructure/redis/redis-client.js', () => ({ redis: { get: mocks.get, set: mocks.set, setex: mocks.setex } }));
vi.mock('@server/database_service.js', () => ({ db: {} }));
vi.mock('@domain/auth/core/encrypted-credentials.service.js', () => ({ encryptedCredentialsService: {} }));
import { GranolaOAuthAdapter } from './granola-oauth.adapter.js';

describe('Granola OAuth adapter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', mocks.fetch);
        delete process.env.GRANOLA_CLIENT_ID;
        delete process.env.GRANOLA_CLIENT_METADATA_URL;
        mocks.get.mockResolvedValue(null);
        mocks.set.mockResolvedValue('OK');
        mocks.setex.mockResolvedValue('OK');
        mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ client_id: 'dcr-client' }) });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('uses PKCE, resource indicators, and dynamic registration', async () => {
        const adapter = new GranolaOAuthAdapter();
        const result = await adapter.getAuthorizationUrl({ organizationId: 8, returnTo: '/settings', customRedirectUri: 'https://oddjob.example/api/me/connections/granola/oauth/callback', extraState: { userId: 'u1' } });
        const url = new URL(result.url);
        expect(url.searchParams.get('client_id')).toBe('dcr-client');
        expect(url.searchParams.get('resource')).toBe('https://mcp.granola.ai/mcp');
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('scope')).toContain('mcp');
        expect(mocks.fetch).toHaveBeenCalledWith('https://mcp-auth.granola.ai/oauth2/register', expect.objectContaining({ method: 'POST' }));
        expect(mocks.setex).toHaveBeenCalled();
    });

    it('uses a configured CIMD URL without dynamic registration', async () => {
        process.env.GRANOLA_CLIENT_METADATA_URL = 'https://oddjob.example/.well-known/oauth-client';
        const result = await new GranolaOAuthAdapter().getAuthorizationUrl({ organizationId: 8, customRedirectUri: 'https://oddjob.example/callback', extraState: { userId: 'u1' } });
        expect(new URL(result.url).searchParams.get('client_id')).toBe(process.env.GRANOLA_CLIENT_METADATA_URL);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
});
