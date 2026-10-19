import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const mocks = vi.hoisted(() => ({ where: vi.fn(), limit: vi.fn(), token: vi.fn(), retrieve: vi.fn(), remove: vi.fn(), set: vi.fn(), updateWhere: vi.fn() }));
vi.mock('@server/database_service.js', () => ({ db: { select: () => ({ from: () => ({ where: mocks.where }) }), update: () => ({ set: mocks.set }) } }));
vi.mock('../core/oauth/quickbooks-oauth.adapter.js', () => ({ quickBooksEnvironment: () => 'sandbox', quickBooksOAuthAdapter: { getValidAccessToken: mocks.token } }));
vi.mock('@domain/auth/core/encrypted-credentials.service.js', () => ({ encryptedCredentialsService: { retrieve: mocks.retrieve, delete: mocks.remove } }));
import { disconnectQuickBooks, findQuickBooksConnection, findConnectorsByRealmId, getQuickBooksClient, upsertSyncLink, quickBooksRecordKey } from './service.js';
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
    vi.clearAllMocks();
    mocks.where.mockReturnValue({ orderBy: () => ({ limit: mocks.limit }) });
    mocks.limit.mockResolvedValue([]);
    mocks.set.mockReturnValue({ where: mocks.updateWhere });
    mocks.retrieve.mockResolvedValue(null);
    mocks.remove.mockResolvedValue(true);
});
describe('QuickBooks tenant and project connection scope', () => {
    it('resolves all active company grants only in the configured environment', async () => {
        mocks.where.mockReturnValueOnce([{ id: 7 }, { id: 8 }]);
        expect(await findConnectorsByRealmId('123')).toHaveLength(2);
        expect(new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual(['quickbooks', 'connected', '123', 'sandbox']);
    });
    it('rejects writing a sync link for another tenant’s connector', async () => {
        // The owner lookup is scoped by both connector and org before insert/update.
        mocks.where.mockReturnValueOnce({ limit: mocks.limit });
        mocks.limit.mockResolvedValue([]);
        await expect(upsertSyncLink(7, 473, { localCollection: 'dataset', localRecordId: 'record', remoteEntity: 'Invoice', remoteId: '1' })).rejects.toThrow(/organization/);
        expect(new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual([7, 473]);
        expect(mocks.set).not.toHaveBeenCalled();
    });
    it('keeps shared Intuit authorization while disconnecting only one organization', async () => {
        mocks.limit.mockResolvedValue([{ id: 7, orgId: 342, projectId: null, config: { realmId: '123' } }]);
        mocks.retrieve.mockResolvedValue({ refreshToken: 'test-token' });
        mocks.where.mockReturnValueOnce({ orderBy: () => ({ limit: mocks.limit }) }).mockReturnValueOnce([{ id: 7 }, { id: 8 }]);
        const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
        await disconnectQuickBooks(342);
        expect(fetcher).not.toHaveBeenCalled();
        expect(mocks.remove).toHaveBeenCalledWith(342, 'saas_connector', 7, 'quickbooks_oauth_token');
        expect(new PgDialect().sqlToQuery(mocks.updateWhere.mock.calls[0][0]).params).toEqual([7, 342]);
    });
    it('uses distinct mirror keys for companies and project connections', () => {
        const key = quickBooksRecordKey({ id: 7, config: { realmId: '123' } }, 'Invoice', '1');
        expect(key).not.toBe(quickBooksRecordKey({ id: 7, config: { realmId: '999' } }, 'Invoice', '1'));
        expect(key).not.toBe(quickBooksRecordKey({ id: 8, config: { realmId: '123' } }, 'Invoice', '1'));
    });
    it('requires an organization before querying connections', async () => {
        await expect(getQuickBooksClient(null, 9)).rejects.toThrow(/organization/);
        expect(mocks.where).not.toHaveBeenCalled();
    });
    it('filters organization connections by tenant and a null project', async () => {
        await findQuickBooksConnection(342);
        const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
        expect(query.params).toEqual([342, 'quickbooks']);
        expect(query.sql).toContain('is null');
    });
    it('allows only the exact project or its organization connection', async () => {
        await findQuickBooksConnection(342, 9);
        const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
        expect(query.params).toEqual([342, 'quickbooks', 9]);
        expect(query.sql).toContain('is null');
    });
    it('does not silently use another connection after a project disconnect', async () => {
        mocks.limit.mockResolvedValue([{ id: 7, status: 'disconnected', projectId: 9 }]);
        await expect(getQuickBooksClient(342, 9)).rejects.toThrow(/Connect QuickBooks/);
        expect(mocks.token).not.toHaveBeenCalled();
    });
    it('disables the scoped connection and removes its stored credentials', async () => {
        mocks.limit.mockResolvedValue([{ id: 7, orgId: 342, projectId: 9 }]);
        await disconnectQuickBooks(342, 9);
        expect(mocks.remove).toHaveBeenCalledWith(342, 'saas_connector', 7, 'quickbooks_oauth_token');
        expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'disconnected', credentialId: null }));
        const dialect = new PgDialect();
        expect(dialect.sqlToQuery(mocks.set.mock.calls[0][0].config).sql).toContain('"enabled":false');
        expect(dialect.sqlToQuery(mocks.updateWhere.mock.calls[0][0]).params).toEqual([7, 342]);
    });
    it('requires organization controls for an inherited connection', async () => {
        mocks.limit.mockResolvedValue([{ id: 7, orgId: 342, projectId: null }]);
        await expect(disconnectQuickBooks(342, 9)).rejects.toThrow(/organization Integrations/);
        expect(mocks.remove).not.toHaveBeenCalled();
    });
});
