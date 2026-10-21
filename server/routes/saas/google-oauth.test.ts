// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ configured: vi.fn(), authorize: vi.fn(), callback: vi.fn(), project: vi.fn(), save: vi.fn(), app: vi.fn(), caller: { organizationId: 7, userId: "owner", isOrgAdmin: true } as any }));
vi.mock('@server/utils/auth-context.js', () => ({ getUserOrgContext: async () => mocks.caller, requireOrgId: (ctx: any) => ctx.organizationId }));
vi.mock('@domain/core/auth/security.service.js', () => ({ requireAuth: (_req: any, _res: any, next: any) => next() }));
vi.mock('@server/database_service.js', () => ({ db: {} }));
vi.mock('@server/integrations/general-gateway.js', () => ({ generalGateway: {} }));
vi.mock('@domain/auth/core/encrypted-credentials.service.js', () => ({ encryptedCredentialsService: {} }));
vi.mock('@domain/core/infrastructure/redis/redis-client.js', () => ({ redis: null }));
vi.mock('@server/middleware/project-scope.js', () => ({ resolveProjectScope: mocks.project }));
vi.mock('@domain/integrations/core/oauth/google-oauth.adapter.js', () => ({ googleOAuthAdapter: { isConfigured: mocks.configured, getAuthorizationUrl: mocks.authorize, handleCallback: mocks.callback } }));
vi.mock('@domain/integrations/core/oauth/jira-oauth.adapter.js', () => ({ jiraOAuthAdapter: {} }));
vi.mock('@domain/integrations/core/oauth/microsoft-oauth.adapter.js', () => ({ microsoftOAuthAdapter: {} }));
vi.mock('@domain/integrations/core/oauth/org-oauth-app.service.js', () => ({ resolveOAuthApp: mocks.app, readOrgOAuthApp: async () => null, saveOrgOAuthApp: mocks.save }));
vi.mock('@domain/integrations/google-workspace-connector-bridge.js', () => ({ findGoogleConnection: async () => null, disconnectGoogleConnection: vi.fn() }));
import router from './connectors.js';
function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/saas', router);
  server.use((err: any, _req: any, res: any, _next: any) => res.status(400).json({ error: err.message }));
  return server;
}
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.configured.mockReturnValue(true);
    mocks.caller = { organizationId: 7, userId: "owner", isOrgAdmin: true };
    mocks.app.mockResolvedValue({ clientId: "app", clientSecret: "private" });
    mocks.authorize.mockResolvedValue({ url: 'https://accounts.google.com/consent' });
    mocks.project.mockResolvedValue({ id: 12 });
    mocks.callback.mockResolvedValue({ returnTo: '/projects/billing' });
  });
describe('Mounted Google adapter flow', () => {
  it('creates combined consent with an explicit authorized project scope', async () => {
    const response = await request(app()).get('/api/saas/connectors/google/oauth/initiate?for=workspace&projectKey=billing');
    expect(response.status).toBe(302);
    expect(mocks.project).toHaveBeenCalledOnce();
    expect(mocks.authorize).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 7, projectId: 12,
      scopes: expect.arrayContaining(['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/calendar']),
      customRedirectUri: expect.stringMatching(/\/api\/saas\/connectors\/google\/oauth\/callback$/),
    }));
  });
  it('keeps organization consent unscoped even when a session may have a selected project', async () => {
    await request(app()).get('/api/saas/connectors/google/oauth/initiate?for=gmail');
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.authorize).toHaveBeenCalledWith(expect.objectContaining({ projectId: null }));
  });
  it('handles the callback at the same URL sent to Google', async () => {
    const response = await request(app()).get('/api/saas/connectors/google/oauth/callback?code=code&state=state');
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/projects/billing');
    expect(mocks.callback).toHaveBeenCalledWith(expect.objectContaining({ code: 'code', stateId: 'state' }));
  });
  it('does not open Google consent with missing deployment configuration', async () => {
    mocks.app.mockResolvedValue({ clientId: "", clientSecret: "" });
    const response = await request(app()).get('/api/saas/connectors/google/oauth/initiate?for=gmail');
    expect(response.status).toBe(400);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it('rejects unknown permission profiles', async () => {
    const response = await request(app()).get('/api/saas/connectors/google/oauth/initiate?for=unknown');
    expect(response.status).toBe(400);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
});

describe('organization OAuth app management', () => {
  it('returns metadata without returning OAuth secrets', async () => {
    const response = await request(app()).get('/api/saas/connectors/google/oauth/app');
    expect(response.body).toMatchObject({ organizationId: 7, configured: true, canManage: true });
    expect(JSON.stringify(response.body)).not.toContain('private');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('saves only to the authenticated organization and rejects cross-org payloads', async () => {
    const response = await request(app()).put('/api/saas/connectors/google/oauth/app').send({ clientId: 'owned', clientSecret: 'new-secret' });
    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(7, 'google', expect.objectContaining({ clientId: 'owned', clientSecret: 'new-secret' }));
    const forged = await request(app()).put('/api/saas/connectors/google/oauth/app').send({ clientId: 'owned', clientSecret: 'new-secret', organizationId: 19 });
    expect(forged.status).toBe(400);
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it('refuses member settings writes and connection replacement', async () => {
    mocks.caller.isOrgAdmin = false;
    expect((await request(app()).put('/api/saas/connectors/google/oauth/app').send({ clientId: 'id', clientSecret: 'secret' })).status).toBe(400);
    expect((await request(app()).get('/api/saas/connectors/google/oauth/initiate')).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it('validates the initiating user and organization before Google callback exchange', async () => {
    mocks.callback.mockImplementation(async options => { await options.validateState({ organizationId: 19, extra: { userId: 'owner' } }); return {}; });
    expect((await request(app()).get('/api/saas/connectors/google/oauth/callback?code=code&state=state')).status).toBe(400);
  });
  it('rejects the legacy connector endpoint’s cross-org and default-org writes', async () => {
    expect((await request(app()).post('/api/saas/create-connector').send({ platform: 'jira', organization_id: 19 })).status).toBe(400);
    mocks.caller.isOrgAdmin = false;
    expect((await request(app()).post('/api/saas/create-connector').send({ platform: 'jira' })).status).toBe(400);
  });
});
