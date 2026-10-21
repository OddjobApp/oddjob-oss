import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ retrieve: vi.fn(), store: vi.fn(), exists: vi.fn() }));
vi.mock('@domain/auth/core/encrypted-credentials.service.js', () => ({ encryptedCredentialsService: mocks }));
import { currentOAuthApp, readOrgOAuthApp, resolveOAuthApp, saveOrgOAuthApp, withOrgOAuthApp } from './org-oauth-app.service.js';
beforeEach(() => { vi.resetAllMocks(); mocks.retrieve.mockResolvedValue(null); mocks.exists.mockResolvedValue(false); });
afterEach(() => vi.unstubAllEnvs());
describe('organization OAuth app credentials', () => {
  it('keeps concurrent organizations isolated across asynchronous work', async () => {
    mocks.retrieve.mockImplementation(async (orgId: number) => ({ clientId: `org-${orgId}`, clientSecret: `secret-${orgId}` }));
    const results = await Promise.all([7, 19].map(orgId => withOrgOAuthApp(orgId, 'google', async () => {
      await new Promise(resolve => setTimeout(resolve, orgId === 7 ? 15 : 1));
      return currentOAuthApp()?.clientId;
    })));
    expect(results).toEqual(['org-7', 'org-19']);
    expect(currentOAuthApp()).toBeUndefined();
  });
  it('prefers organization credentials and only falls back when no org app exists', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'shared'); vi.stubEnv('GOOGLE_CLIENT_SECRET', 'shared-secret');
    expect((await resolveOAuthApp(7, 'google')).clientId).toBe('shared');
    mocks.retrieve.mockResolvedValue({ clientId: 'owned', clientSecret: 'private' });
    expect((await resolveOAuthApp(7, 'google')).clientId).toBe('owned');
    expect(mocks.retrieve).toHaveBeenLastCalledWith(7, 'organization_oauth_app', 7, 'google');
  });
  it('fails closed when an existing org app cannot be decrypted', async () => {
    mocks.exists.mockResolvedValue(true);
    await expect(resolveOAuthApp(7, 'google')).rejects.toThrow('could not be decrypted');
  });
  it('never maps a missing organization to org 1', async () => {
    await expect(readOrgOAuthApp(null as any, 'google')).rejects.toThrow('require an organization');
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });
  it('stores app secrets in the encrypted credential service under the owning org', async () => {
    await saveOrgOAuthApp(19, 'quickbooks', { clientId: 'id', clientSecret: 'private', environment: 'production' });
    expect(mocks.store).toHaveBeenCalledWith(19, 'organization_oauth_app', 19, 'quickbooks', expect.objectContaining({ clientSecret: 'private' }));
  });
});
