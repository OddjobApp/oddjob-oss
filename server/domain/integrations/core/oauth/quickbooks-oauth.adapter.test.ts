import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ caller: { userId: 'owner', organizationId: 342, isOrgAdmin: true, isSuperAdmin: false } as any }));
vi.mock('@server/database_service.js', () => ({ db: {} }));
vi.mock('@domain/core/infrastructure/redis/redis-client.js', () => ({ redis: {} }));
vi.mock('@domain/auth/core/encrypted-credentials.service.js', () => ({ encryptedCredentialsService: {} }));
vi.mock('@server/utils/auth-context.js', () => ({ getUserOrgContext: async () => mocks.caller, requireOrgId: (c: any) => c.organizationId }));
import { BaseOAuthAdapter } from './base-oauth.adapter.js';
import { QuickBooksOAuthAdapter } from './quickbooks-oauth.adapter.js';
beforeEach(() => { mocks.caller = { userId: 'owner', organizationId: 342, isOrgAdmin: true, isSuperAdmin: false }; });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function configured() { vi.stubEnv('QUICKBOOKS_CLIENT_ID', 'app'); vi.stubEnv('QUICKBOOKS_CLIENT_SECRET', 'secret'); vi.stubEnv('QUICKBOOKS_ENVIRONMENT', 'sandbox'); return new QuickBooksOAuthAdapter(); }
describe('Intuit OAuth adapter', () => {
    it('uses Basic auth and form encoding and retains rotated refresh tokens', async () => {
        const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'access', refresh_token: 'rotated', expires_in: 3600 }) });
        vi.stubGlobal('fetch', fetcher);
        const tokens = await configured().refreshAccessToken('old-token');
        expect(tokens.refreshToken).toBe('rotated');
        const [, options] = fetcher.mock.calls[0];
        expect(options.headers.Authorization).toBe(`Basic ${Buffer.from('app:secret').toString('base64')}`);
        expect(new URLSearchParams(options.body).get('refresh_token')).toBe('old-token');
        expect(tokens.rawPayload).toBeUndefined();
    });
    it('binds the callback company to the original organization and user', async () => {
        const adapter = configured();
        vi.spyOn(BaseOAuthAdapter.prototype, 'handleCallback').mockImplementation(async options => {
            const state = { organizationId: 342, extra: { userId: 'owner', environment: 'sandbox' } } as any;
            await options.validateState?.(state);
            expect(state.extra.realmId).toBe('12345');
            return { connectorId: 7 } as any;
        });
        await expect(adapter.handleCallback({ code: 'code', stateId: 'state', req: { query: { realmId: '12345' } } as any })).resolves.toMatchObject({ connectorId: 7 });
    });
    it('allows a super admin callback when the browser falls back to a different active organization', async () => {
        mocks.caller = { userId: 'owner', organizationId: 1, isOrgAdmin: true, isSuperAdmin: true };
        const adapter = configured();
        vi.spyOn(BaseOAuthAdapter.prototype, 'handleCallback').mockImplementation(async options => {
            await options.validateState?.({ organizationId: 342, extra: { userId: 'owner', environment: 'sandbox' } } as any);
            return { connectorId: 7 } as any;
        });
        await expect(adapter.handleCallback({ code: 'code', stateId: 'state', req: { query: { realmId: '12345' } } as any })).resolves.toMatchObject({ connectorId: 7 });
    });
    it('refuses an org admin callback when the active organization differs from the initiating organization', async () => {
        mocks.caller = { userId: 'owner', organizationId: 1, isOrgAdmin: true, isSuperAdmin: false };
        const adapter = configured();
        vi.spyOn(BaseOAuthAdapter.prototype, 'handleCallback').mockImplementation(async options => {
            await options.validateState?.({ organizationId: 342, extra: { userId: 'owner', environment: 'sandbox' } } as any);
            return {} as any;
        });
        await expect(adapter.handleCallback({ code: 'code', stateId: 'state', req: { query: { realmId: '12345' } } as any })).rejects.toThrow(/different user or organization/);
    });
    it('refuses mismatched state and malformed company IDs before persistence', async () => {
        const adapter = configured();
        vi.spyOn(BaseOAuthAdapter.prototype, 'handleCallback').mockImplementation(async options => {
            await options.validateState?.({ organizationId: 999, extra: { userId: 'someone', environment: 'sandbox' } } as any);
            return {} as any;
        });
        await expect(adapter.handleCallback({ code: 'code', stateId: 'state', req: { query: { realmId: '12345' } } as any })).rejects.toThrow(/different user or organization/);
        await expect(adapter.handleCallback({ code: 'code', stateId: 'state', req: { query: { realmId: '../other' } } as any })).rejects.toThrow(/realmId/);
    });
    it('keeps token endpoint failures free of raw secrets', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'secret-token' }));
        await expect(configured().refreshAccessToken('refresh')).rejects.toThrow('QuickBooks token request failed (401)');
    });
});
