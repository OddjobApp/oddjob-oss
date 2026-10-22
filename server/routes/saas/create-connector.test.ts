// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A connector belongs to the caller's organization. The route used to take
 * `organization_id` from the body (defaulting to 1), so any signed-in user could
 * overwrite another organization's connector — its credentials and base URL.
 */
const mocks = vi.hoisted(() => ({
    context: { organizationId: 7 as number | null, isOrgAdmin: true, isSuperAdmin: false },
    existing: [] as any[], inserted: vi.fn(), updated: vi.fn(), whereOrg: [] as unknown[],
}));
vi.mock('@server/utils/auth-context.js', () => ({
    getUserOrgContext: async () => mocks.context,
    requireOrgId: (ctx: any) => { if (!ctx.organizationId) throw Object.assign(new Error('Organization context required'), { status: 403 }); return ctx.organizationId; },
}));
vi.mock('@domain/core/auth/security.service.js', () => ({ requireAuth: (_req: any, _res: any, next: any) => next() }));
vi.mock('@server/database_service.js', () => ({
    db: {
        select: () => ({ from: () => ({ where: (cond: unknown) => { mocks.whereOrg.push(cond); return { limit: async () => mocks.existing }; } }) }),
        insert: () => ({ values: (v: any) => { mocks.inserted(v); return { returning: async () => [v] }; } }),
        update: () => ({ set: (v: any) => { mocks.updated(v); return { where: () => ({ returning: async () => [v] }) }; } }),
    },
}));
vi.mock('@server/integrations/general-gateway.js', () => ({ generalGateway: {} }));
vi.mock('@domain/auth/core/encrypted-credentials.service.js', () => ({ encryptedCredentialsService: {} }));
vi.mock('@domain/core/infrastructure/redis/redis-client.js', () => ({ redis: null }));
vi.mock('@server/middleware/project-scope.js', () => ({ resolveProjectScope: vi.fn() }));
vi.mock('@domain/integrations/core/oauth/google-oauth.adapter.js', () => ({ googleOAuthAdapter: {} }));
vi.mock('@domain/integrations/core/oauth/jira-oauth.adapter.js', () => ({ jiraOAuthAdapter: {} }));
vi.mock('@domain/integrations/core/oauth/microsoft-oauth.adapter.js', () => ({ microsoftOAuthAdapter: {} }));
import router from './connectors.js';

function app() {
    const server = express();
    server.use(express.json());
    server.use('/api/saas', router);
    server.use((err: any, _req: any, res: any, _next: any) => res.status(err.status ?? 400).json({ error: err.message }));
    return server;
}
const body = { platform: 'jira', organization_id: 1, credentials: { base_url: 'https://attacker.example', api_key: 'stolen' } };

describe('POST /api/saas/create-connector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.context = { organizationId: 7, isOrgAdmin: true, isSuperAdmin: false };
        mocks.existing = [];
        mocks.whereOrg = [];
    });

    it("writes the caller's organization, ignoring an organization named in the body", async () => {
        const response = await request(app()).post('/api/saas/create-connector').send(body);
        expect(response.status).toBe(200);
        expect(mocks.inserted).toHaveBeenCalledWith(expect.objectContaining({ orgId: 7, platform: 'jira' }));
        expect(mocks.inserted.mock.calls[0][0].orgId).not.toBe(1);
    });

    it('refuses a member who is not an organization administrator, before touching storage', async () => {
        mocks.context = { organizationId: 7, isOrgAdmin: false, isSuperAdmin: false };
        const response = await request(app()).post('/api/saas/create-connector').send(body);
        expect(response.status).toBe(403);
        expect(mocks.inserted).not.toHaveBeenCalled();
        expect(mocks.updated).not.toHaveBeenCalled();
        expect(mocks.whereOrg).toHaveLength(0);
    });

    it('refuses a caller with no organization instead of falling back to organization 1', async () => {
        mocks.context = { organizationId: null, isOrgAdmin: true, isSuperAdmin: false };
        const response = await request(app()).post('/api/saas/create-connector').send(body);
        expect(response.status).toBe(403);
        expect(mocks.inserted).not.toHaveBeenCalled();
    });
});
