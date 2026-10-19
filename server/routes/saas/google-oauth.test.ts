// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ configured: vi.fn(), authorize: vi.fn(), callback: vi.fn(), project: vi.fn() }));
vi.mock('@server/utils/auth-context.js', () => ({ getUserOrgContext: async () => ({ organizationId: 7 }), requireOrgId: (ctx: any) => ctx.organizationId }));
vi.mock('@domain/core/auth/security.service.js', () => ({ requireAuth: (_req: any, _res: any, next: any) => next() }));
vi.mock('@server/database_service.js', () => ({ db: {} }));
vi.mock('@server/integrations/general-gateway.js', () => ({ generalGateway: {} }));
vi.mock('@domain/auth/core/encrypted-credentials.service.js', () => ({ encryptedCredentialsService: {} }));
vi.mock('@domain/core/infrastructure/redis/redis-client.js', () => ({ redis: null }));
vi.mock('@server/middleware/project-scope.js', () => ({ resolveProjectScope: mocks.project }));
vi.mock('@domain/integrations/core/oauth/google-oauth.adapter.js', () => ({ googleOAuthAdapter: { isConfigured: mocks.configured, getAuthorizationUrl: mocks.authorize, handleCallback: mocks.callback } }));
vi.mock('@domain/integrations/core/oauth/jira-oauth.adapter.js', () => ({ jiraOAuthAdapter: {} }));
vi.mock('@domain/integrations/core/oauth/microsoft-oauth.adapter.js', () => ({ microsoftOAuthAdapter: {} }));
import router from './connectors.js';
function app() {
  const server = express();
  server.use('/api/saas', router);
  server.use((err: any, _req: any, res: any, _next: any) => res.status(400).json({ error: err.message }));
  return server;
}
describe('Mounted Google adapter flow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.configured.mockReturnValue(true);
    mocks.authorize.mockResolvedValue({ url: 'https://accounts.google.com/consent' });
    mocks.project.mockResolvedValue({ id: 12 });
    mocks.callback.mockResolvedValue({ returnTo: '/projects/billing' });
  });
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
    mocks.configured.mockReturnValue(false);
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
