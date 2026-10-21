vi.mock('@domain/integrations/core/oauth/org-oauth-app.service.js', () => ({ resolveOAuthApp: async () => ({ clientId: 'id', clientSecret: 'secret', environment: 'sandbox' }) }));
// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ anyRole: vi.fn(), authorize: vi.fn(), callback: vi.fn(), project: vi.fn(), find: vi.fn(), client: vi.fn(), disconnect: vi.fn(), caller: { organizationId: 342, userId: 'owner', isOrgAdmin: true, isSuperAdmin: false } as any }));
vi.mock('@server/utils/auth-context.js', () => ({ getUserOrgContext: async () => mocks.caller, requireOrgId: (c: any) => c.organizationId }));
vi.mock('@domain/core/auth/security.service.js', () => ({ requireAuth: (_r: any, _s: any, n: any) => n() }));
vi.mock('@server/middleware/project-scope.js', () => ({ resolveProjectScope: mocks.project }));
vi.mock('@domain/integrations/core/oauth/quickbooks-oauth.adapter.js', () => ({ quickBooksEnvironment: () => 'sandbox', quickBooksOAuthAdapter: {
    isConfigured: () => true, resolveRedirectUri: () => 'http://localhost:5000/api/saas/connectors/quickbooks/oauth/callback', getAuthorizationUrl: mocks.authorize, handleCallback: mocks.callback,
} }));
vi.mock('@domain/projects/core/finance-roles.service.js', () => ({ financeRolesService: { assertAnyRole: mocks.anyRole } }));
vi.mock('@domain/integrations/quickbooks/service.js', () => ({ findQuickBooksConnection: mocks.find, getQuickBooksClient: mocks.client, disconnectQuickBooks: mocks.disconnect }));
import router from './quickbooks.js';
const app = () => { const a = express(); a.use('/api/saas', router); a.use((e: any, _r: any, res: any, _n: any) => res.status(400).json({ error: e.message })); return a; };
beforeEach(() => { vi.clearAllMocks(); mocks.caller = { organizationId: 342, userId: 'owner', isOrgAdmin: true, isSuperAdmin: false }; mocks.project.mockResolvedValue({ id: 9 }); mocks.authorize.mockResolvedValue({ url: 'https://appcenter.intuit.com/connect/oauth2' }); mocks.callback.mockResolvedValue({ returnTo: '/projects/books' }); mocks.find.mockResolvedValue(null); });
describe('mounted QuickBooks connection flow', () => {
    it('binds consent to the authorized project and initiating user', async () => {
        expect((await request(app()).get('/api/saas/connectors/quickbooks/oauth/initiate?projectKey=books')).status).toBe(302);
        expect(mocks.authorize).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 342, projectId: 9, extraState: { userId: 'owner' } }));
    });
    it('does not silently use the session project for organization consent', async () => {
        await request(app()).get('/api/saas/connectors/quickbooks/oauth/initiate');
        expect(mocks.project).not.toHaveBeenCalled();
        expect(mocks.authorize).toHaveBeenCalledWith(expect.objectContaining({ projectId: null }));
    });
    it('handles the company callback without returning access tokens', async () => {
        const r = await request(app()).get('/api/saas/connectors/quickbooks/oauth/callback?code=code&state=state&realmId=123');
        expect(r.status).toBe(302); expect(r.headers.location).toBe('/projects/books');
        expect(mocks.callback).toHaveBeenCalledWith(expect.objectContaining({ code: 'code', stateId: 'state' }));
    });
    it('refuses inaccessible project scopes before starting OAuth', async () => {
        mocks.project.mockRejectedValue(new Error('Project access denied'));
        expect((await request(app()).get('/api/saas/connectors/quickbooks/oauth/initiate?projectKey=private')).status).toBe(400);
        expect(mocks.authorize).not.toHaveBeenCalled();
    });
    it('lets only an org admin disconnect, since it can revoke the company grant for everyone', async () => {
        mocks.caller = { organizationId: 342, userId: 'member', isOrgAdmin: false, isSuperAdmin: false };
        expect((await request(app()).post('/api/saas/connectors/quickbooks/disconnect')).status).toBe(400);
        expect(mocks.disconnect).not.toHaveBeenCalled();
        mocks.caller = { organizationId: 342, userId: 'owner', isOrgAdmin: true, isSuperAdmin: false };
        expect((await request(app()).post('/api/saas/connectors/quickbooks/disconnect')).status).toBe(200);
        expect(mocks.disconnect).toHaveBeenCalledWith(342, null);
    });
    it('lets only an org admin connect, since a reconnect replaces the company for everyone', async () => {
        mocks.caller = { organizationId: 342, userId: 'member', isOrgAdmin: false, isSuperAdmin: false };
        expect((await request(app()).get('/api/saas/connectors/quickbooks/oauth/initiate')).status).toBe(400);
        expect(mocks.authorize).not.toHaveBeenCalled();
    });
    it('lets a member test the connection only with a finance role', async () => {
        mocks.client.mockResolvedValue({ client: { realmId: '123', company: async () => ({ CompanyName: 'Books Co' }) } });
        mocks.caller = { organizationId: 342, userId: 'member', isOrgAdmin: false, isSuperAdmin: false };
        mocks.anyRole.mockRejectedValueOnce(new Error('QuickBooks access needs a finance role'));
        expect((await request(app()).post('/api/saas/connectors/quickbooks/test')).status).toBe(400);
        expect(mocks.client).not.toHaveBeenCalled();
        mocks.anyRole.mockResolvedValueOnce({ any: true });
        expect((await request(app()).post('/api/saas/connectors/quickbooks/test')).body.companyName).toBe('Books Co');
    });
    it('tells the client whether the caller can manage the connection', async () => {
        expect((await request(app()).get('/api/saas/connectors/quickbooks/oauth/status')).body.canManage).toBe(true);
        mocks.caller = { organizationId: 342, userId: 'member', isOrgAdmin: false, isSuperAdmin: false };
        expect((await request(app()).get('/api/saas/connectors/quickbooks/oauth/status')).body.canManage).toBe(false);
    });
});
