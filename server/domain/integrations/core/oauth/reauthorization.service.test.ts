import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ results: [] as any[][] }));

vi.mock('@server/database_service.js', () => ({
    db: {
        select: () => ({ from: () => ({ where: async () => mocks.results.shift() ?? [] }) }),
    },
}));
vi.mock('@domain/core/infrastructure/redis/redis-client.js', () => ({ redis: {} }));
vi.mock('@domain/auth/core/encrypted-credentials.service.js', () => ({ encryptedCredentialsService: {} }));
vi.mock('@server/utils/auth-context.js', () => ({ getUserOrgContext: vi.fn(), requireOrgId: (c: any) => c.organizationId }));

import { listReauthorizations, reconnectTargetFor } from './reauthorization.service.js';
import { oauthAdapterRegistry } from './oauth-adapter.registry.js';
import { granolaOAuthAdapter } from '@domain/integrations/granola/granola-oauth.adapter.js';
import { GOOGLE_CONNECTION_PROFILES } from '@shared/google-connection.js';

const scope = { organizationId: 342, userId: 'user-a', projectId: null as number | null, isOrgAdmin: false, isSuperAdmin: false };

function flagged(platform: string, over: Record<string, any> = {}) {
    return {
        id: 1, orgId: 342, userId: 'user-a', platform, status: 'error', projectId: null, ...over,
        config: { reauth_required: true, reauth_reason: 'refresh_rejected', reauth_at: '2026-01-01T00:00:00Z', ...(over.config || {}) },
    };
}

describe('reconnectTargetFor coverage', () => {
    it('covers every registered OAuth adapter plus Granola', () => {
        const platforms = [...oauthAdapterRegistry.getRegisteredPlatforms(), granolaOAuthAdapter.platform];
        expect(platforms.length).toBeGreaterThanOrEqual(6);
        for (const platform of platforms) {
            const target = reconnectTargetFor(platform, {});
            expect(target, platform).toBeDefined();
            expect(target!.path, platform).toMatch(/^\/(api|admin)\//);
        }
    });

    it('falls back to the dashboard for unknown platforms instead of dropping them', () => {
        const target = reconnectTargetFor('confluence', {});
        expect(target).toMatchObject({ path: '/admin/integrations', opensDashboard: true, label: 'confluence' });
    });
});

describe('google profile inference', () => {
    const scopes = (profile: keyof typeof GOOGLE_CONNECTION_PROFILES) => [...GOOGLE_CONNECTION_PROFILES[profile].scopes];

    it('picks drive for drive scopes', () => {
        expect(reconnectTargetFor('google', { scopes: scopes('drive') })).toMatchObject({
            label: 'Google Drive', query: { for: 'drive' },
        });
    });

    it('picks workspace for the combined scope set', () => {
        expect(reconnectTargetFor('google', { scopes: scopes('workspace') })).toMatchObject({
            query: { for: 'workspace' },
        });
    });

    it('prefers the broadest matching profile over a subset', () => {
        const gmailPlus = [...scopes('gmail'), ...scopes('calendar')];
        const target = reconnectTargetFor('google', { scopes: gmailPlus });
        expect(target!.query!.for).toBe('gmail');
    });

    it('falls back to workspace for unknown scopes', () => {
        expect(reconnectTargetFor('google', { scopes: ['https://example.com/unknown'] })).toMatchObject({ query: { for: 'workspace' } });
        expect(reconnectTargetFor('google', {})).toMatchObject({ query: { for: 'workspace' } });
    });
});

describe('listReauthorizations', () => {
    beforeEach(() => { vi.clearAllMocks(); mocks.results = []; });

    it('returns flagged org connectors with reconnect URLs', async () => {
        mocks.results = [[flagged('jira'), flagged('slack', { id: 2 })], []];
        const items = await listReauthorizations(scope);
        expect(items).toHaveLength(2);
        const jira = items.find(i => i.platform === 'jira')!;
        expect(jira.reconnectUrl).toBe('/api/saas/connectors/jira/oauth/initiate?orgId=342');
        expect(jira.kind).toBe('organization');
        expect(jira.reason).toBe('refresh_rejected');
        const slack = items.find(i => i.platform === 'slack')!;
        expect(slack.opensDashboard).toBe(true);
        expect(slack.reconnectUrl).toContain('/admin/integrations?');
        expect(slack.reconnectUrl).toContain('platform=slack');
    });

    it('ignores error rows without the reauthorization flag', async () => {
        mocks.results = [[{ ...flagged('jira'), config: {} }], []];
        expect(await listReauthorizations(scope)).toHaveLength(0);
    });

    it('includes the project id for project-scoped connectors', async () => {
        mocks.results = [[flagged('jira'), flagged('jira', { id: 5, projectId: 9 })], []];
        const items = await listReauthorizations({ ...scope, projectId: 9 });
        const scoped = items.find(i => i.projectId === 9)!;
        expect(scoped.reconnectUrl).toContain('projectId=9');
        expect(items.find(i => i.projectId === null)!.reconnectUrl).not.toContain('projectId');
    });

    it('marks QuickBooks as admin-only for non-admin callers', async () => {
        mocks.results = [[flagged('quickbooks')], []];
        expect((await listReauthorizations(scope))[0].canReauthorize).toBe(false);
        mocks.results = [[flagged('quickbooks')], []];
        expect((await listReauthorizations({ ...scope, isOrgAdmin: true }))[0].canReauthorize).toBe(true);
    });

    it('marks Google as admin-only for non-admin callers', async () => {
        mocks.results = [[flagged('google')], []];
        expect((await listReauthorizations(scope))[0].canReauthorize).toBe(false);
        mocks.results = [[flagged('google')], []];
        expect((await listReauthorizations({ ...scope, isOrgAdmin: true }))[0].canReauthorize).toBe(true);
    });

    it('lists flagged user connections with kind user', async () => {
        mocks.results = [[], [flagged('granola', { id: 8 })]];
        const items = await listReauthorizations(scope);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            kind: 'user', platform: 'granola', label: 'Granola',
            reconnectUrl: '/api/me/connections/granola/oauth/initiate?orgId=342',
        });
    });
});
