// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    list: vi.fn(),
    project: vi.fn(),
    caller: { organizationId: 342, userId: 'owner', isOrgAdmin: true, isSuperAdmin: false } as any,
}));

vi.mock('@domain/core/auth/security.service.js', () => ({ requireAuth: (_r: any, _s: any, n: any) => n() }));
vi.mock('@server/middleware/error-handler.js', () => ({
    asyncHandler: (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res)).catch(next),
}));
vi.mock('@server/utils/auth-context.js', () => ({ getUserOrgContext: async () => mocks.caller, requireOrgId: (c: any) => c.organizationId }));
vi.mock('@server/middleware/project-scope.js', () => ({ resolveProjectScope: mocks.project }));
vi.mock('@domain/integrations/granola/service.js', () => ({
    findGranolaConnection: vi.fn(), listUserConnections: vi.fn(async () => []),
    updateGranolaAccount: vi.fn(), updateGranolaSync: vi.fn(), getGranolaForContext: vi.fn(),
}));
vi.mock('@domain/integrations/granola/granola-oauth.adapter.js', () => ({ granolaOAuthAdapter: { resolveRedirectUri: vi.fn(), getAuthorizationUrl: vi.fn(), handleCallback: vi.fn(), getValidAccessToken: vi.fn(), disconnect: vi.fn() } }));
vi.mock('@domain/integrations/granola/client.js', () => ({ GranolaMcpClient: vi.fn() }));
vi.mock('@domain/integrations/granola/sync.js', () => ({ syncGranolaConnection: vi.fn() }));
vi.mock('@domain/integrations/granola/rooms.js', () => ({ shareMeetingIntoRoom: vi.fn() }));
vi.mock('@domain/crew/core/crew-workspace-results.js', () => ({ workspaceResultPayload: vi.fn() }));
vi.mock('@domain/integrations/core/oauth/reauthorization.service.js', () => ({ listReauthorizations: mocks.list }));

import router from './connections.js';

const app = () => {
    const a = express();
    a.use('/api/me', router);
    a.use((e: any, _r: any, res: any, _n: any) => res.status(400).json({ error: e.message }));
    return a;
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.caller = { organizationId: 342, userId: 'owner', isOrgAdmin: true, isSuperAdmin: false };
    mocks.project.mockResolvedValue({ id: 9, key: 'books' });
    mocks.list.mockResolvedValue([]);
});

describe('GET /api/me/connections/reauthorizations', () => {
    it('returns the flagged items', async () => {
        mocks.list.mockResolvedValue([{ kind: 'organization', platform: 'jira', label: 'Jira', connectorId: 3, projectId: null, reason: 'refresh_rejected', since: null, reconnectUrl: '/api/saas/connectors/jira/oauth/initiate?orgId=342', opensDashboard: false, canReauthorize: true }]);
        const res = await request(app()).get('/api/me/connections/reauthorizations');
        expect(res.status).toBe(200);
        expect(res.body.items).toHaveLength(1);
        expect(res.body.items[0].platform).toBe('jira');
        expect(mocks.list).toHaveBeenCalledWith({ organizationId: 342, userId: 'owner', projectId: null, isOrgAdmin: true, isSuperAdmin: false });
    });

    it('forwards a projectKey scope to the listing', async () => {
        const res = await request(app()).get('/api/me/connections/reauthorizations?projectKey=books');
        expect(res.status).toBe(200);
        expect(mocks.project).toHaveBeenCalled();
        expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ projectId: 9 }));
    });

    it('does not resolve a project when none is named', async () => {
        await request(app()).get('/api/me/connections/reauthorizations');
        expect(mocks.project).not.toHaveBeenCalled();
    });
});
