import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const mocks = vi.hoisted(() => ({
    findLink: vi.fn(), upsertLink: vi.fn(), deleteLink: vi.fn(), clientFor: vi.fn(),
    forOrg: vi.fn(), ensureDataset: vi.fn(), addItems: vi.fn(), publish: vi.fn(),
    syncConfigRows: vi.fn(), updateSet: vi.fn(), snapshotInsert: vi.fn(), snapshotRows: vi.fn(),
}));
vi.mock('./service.js', async original => ({ ...(await original<any>()), clientForConnector: mocks.clientFor, findSyncLink: mocks.findLink, upsertSyncLink: mocks.upsertLink, deleteSyncLink: mocks.deleteLink }));
vi.mock('@server/database_service.js', () => ({ db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.syncConfigRows, orderBy: () => ({ limit: mocks.snapshotRows }) }) }) }),
    update: () => ({ set: () => ({ where: mocks.updateSet }) }),
    insert: () => ({ values: mocks.snapshotInsert }),
} }));
vi.mock('../../knowledge/index.js', () => ({ datasetService: { ensurePlatformDataset: mocks.ensureDataset, addItems: mocks.addItems } }));
vi.mock('../../core/infrastructure/event-stream.service.js', () => ({ eventStream: { publish: mocks.publish } }));
vi.mock('@domain/finance/core/app-records-store.js', () => ({ AppRecordsStore: { forOrg: mocks.forOrg } }));

import { applyQuickBooksRecord, refreshQuickBooksRecord, syncQuickBooks } from './sync.js';

const connector = { id: 7, orgId: 342, platform: 'quickbooks', status: 'connected', config: { realmId: '123', environment: 'sandbox' } } as any;
const store = () => ({ get: vi.fn().mockResolvedValue(null), upsert: vi.fn(), delete: vi.fn() });
const invoice = (over: any = {}) => ({ Id: '10', DocNumber: 'INV-10', TotalAmt: 100, Balance: 40, SyncToken: '1',
    CustomerRef: { value: '2', name: 'Ada' }, TxnDate: '2026-10-01', DueDate: '2026-10-31',
    MetaData: { CreateTime: '2026-10-01T00:00:00Z', LastUpdatedTime: '2026-10-02T00:00:00Z' }, ...over });

beforeEach(() => {
    vi.clearAllMocks();
    mocks.syncConfigRows.mockResolvedValue([]);
    mocks.snapshotRows.mockResolvedValue([]);
    mocks.updateSet.mockResolvedValue(undefined);
    mocks.ensureDataset.mockResolvedValue({ id: 5 });
    mocks.addItems.mockResolvedValue({ inserted: 0 });
    mocks.publish.mockResolvedValue('e');
    mocks.upsertLink.mockImplementation(async (_c: number, _o: number, l: any) => ({ id: 1, ...l }));
});

describe('QuickBooks finance mirror', () => {
    it('rejects cross-tenant apply, sync, and refresh before any access', async () => {
        const s = store();
        await expect(applyQuickBooksRecord(connector, invoice(), 'Invoice', 473, s as any, 'ctx')).rejects.toThrow(/organization/);
        await expect(syncQuickBooks(connector, {}, { organizationId: 473, userId: 'system' }, 'knowledge_store')).rejects.toThrow(/organization/);
        await expect(refreshQuickBooksRecord(connector, 'Invoice', '10', { organizationId: 473 })).rejects.toThrow(/organization/);
        expect(mocks.clientFor).not.toHaveBeenCalled();
        expect(mocks.forOrg).not.toHaveBeenCalled();
        expect(mocks.findLink).not.toHaveBeenCalled();
        expect(s.upsert).not.toHaveBeenCalled();
    });
    it('isolates the same invoice ID in different companies and project connections', async () => {
        mocks.findLink.mockResolvedValue(null);
        const s = store();
        await applyQuickBooksRecord(connector, invoice(), 'Invoice', 342, s as any, 'ctx');
        await applyQuickBooksRecord({ ...connector, id: 8, config: { realmId: '999', environment: 'sandbox' } }, invoice(), 'Invoice', 342, s as any, 'ctx');
        await applyQuickBooksRecord({ ...connector, id: 9 }, invoice(), 'Invoice', 342, s as any, 'ctx');
        expect(s.upsert.mock.calls.map(call => call[1])).toEqual(['qbo:123:7:invoice:10', 'qbo:999:8:invoice:10', 'qbo:123:9:invoice:10']);
    });
    it('maps an invoice into a receivable with source-accurate amounts', async () => {
        const s = store();
        mocks.findLink.mockResolvedValue(null);
        const outcome = await applyQuickBooksRecord(connector, invoice(), 'Invoice', 342, s as any, 'ctx_business_schedule_e');
        expect(outcome).toBe('applied');
        expect(s.upsert).toHaveBeenCalledWith('receivables', 'qbo:123:7:invoice:10', expect.objectContaining({
            invoice_id: 'INV-10', customer_token: 'Ada', amount: 100, amount_paid: 60, status: 'PARTIAL',
            issued_date: '2026-10-01', due_date: '2026-10-31',
        }));
        expect(mocks.upsertLink).toHaveBeenCalledWith(7, 342, expect.objectContaining({
            remoteEntity: 'Invoice', remoteId: '10', remoteSyncToken: '1', localCollection: 'receivables', localRecordId: 'qbo:123:7:invoice:10',
        }));
    });
    it('marks paid invoices and keeps local annotations on re-sync', async () => {
        const s = store();
        s.get.mockResolvedValue({ data: { context_id: 'ctx_custom', last_reminder_at: '2026-10-05' } });
        mocks.findLink.mockResolvedValue({ id: 1, remoteUpdatedAt: new Date('2026-10-01T00:00:00Z'), localHash: 'old' });
        await applyQuickBooksRecord(connector, invoice({ Balance: 0 }), 'Invoice', 342, s as any, 'ctx_business_schedule_e');
        expect(s.upsert).toHaveBeenCalledWith('receivables', 'qbo:123:7:invoice:10', expect.objectContaining({
            status: 'PAID', amount_paid: 100, context_id: 'ctx_custom', last_reminder_at: '2026-10-05',
        }));
    });
    it('removes deleted remote records from the mirror and the link table', async () => {
        const s = store();
        mocks.findLink.mockResolvedValue({ id: 1, localCollection: 'receivables', localRecordId: 'qbo:123:7:invoice:10' });
        const outcome = await applyQuickBooksRecord(connector, invoice({ status: 'Deleted' }), 'Invoice', 342, s as any, 'ctx_business_schedule_e');
        expect(outcome).toBe('deleted');
        expect(s.delete).toHaveBeenCalledWith('receivables', 'qbo:123:7:invoice:10');
        expect(mocks.deleteLink).toHaveBeenCalledWith(7, 'Invoice', '10', 342);
    });
    it('mirrors payments as income and purchases as expenses', async () => {
        const s = store();
        mocks.findLink.mockResolvedValue(null);
        await applyQuickBooksRecord(connector, { Id: '3', TotalAmt: 40, TxnDate: '2026-10-03', CustomerRef: { name: 'Ada' }, MetaData: {} }, 'Payment', 342, s as any, 'ctx');
        expect(s.upsert).toHaveBeenCalledWith('transactions', 'qbo:123:7:payment:3', expect.objectContaining({ amount: 40, payee_raw: 'Ada', current_status: 'CLEARED' }));
        await applyQuickBooksRecord(connector, { Id: '4', TotalAmt: 25, TxnDate: '2026-10-04', EntityRef: { name: 'Staples' }, MetaData: {} }, 'Purchase', 342, s as any, 'ctx');
        expect(s.upsert).toHaveBeenCalledWith('transactions', 'qbo:123:7:purchase:4', expect.objectContaining({ amount: -25 }));
    });
    it('skips rewrites when neither the remote record nor the mirror moved', async () => {
        const s = store();
        mocks.findLink.mockResolvedValue(null);
        await applyQuickBooksRecord(connector, invoice(), 'Invoice', 342, s as any, 'ctx_business_schedule_e');
        const link = mocks.upsertLink.mock.calls[0][2];
        mocks.findLink.mockResolvedValue(link);
        mocks.upsertLink.mockClear(); s.upsert.mockClear();
        const outcome = await applyQuickBooksRecord(connector, invoice(), 'Invoice', 342, s as any, 'ctx_business_schedule_e');
        expect(outcome).toBe('unchanged');
        expect(s.upsert).not.toHaveBeenCalled();
    });
});

describe('QuickBooks sync run', () => {
    it('full-pulls every entity into the dataset on first sync', async () => {
        mocks.clientFor.mockReturnValue({ company: vi.fn().mockResolvedValue({ HomeCurrency: { value: 'USD' } }), list: vi.fn().mockResolvedValue({ items: [invoice()], nextStart: null }), cdc: vi.fn() });
        mocks.forOrg.mockResolvedValue(store());
        mocks.findLink.mockResolvedValue(null);
        const result = await syncQuickBooks({ ...connector, config: { realmId: '123', environment: 'sandbox' } }, { filters: { entities: ['Invoice'] } }, { organizationId: 342, userId: 'system' }, 'knowledge_store');
        expect(result.mode).toBe('full');
        expect(result.records).toBe(1);
        expect(mocks.addItems).toHaveBeenCalledWith(5, [expect.objectContaining({ data: expect.objectContaining({ entity: 'Invoice', source: 'quickbooks' }) })], expect.anything());
        expect(mocks.updateSet).toHaveBeenCalled();
        // A completed sync must not revive a connector disconnected while it ran.
        const condition = new PgDialect().sqlToQuery(mocks.updateSet.mock.calls[0][0]);
        expect(condition.params).toEqual([7, 342, 'connected']);
    });
    it('uses CDC after the watermark and does not re-add known records to the dataset', async () => {
        mocks.clientFor.mockReturnValue({ company: vi.fn().mockResolvedValue({ HomeCurrency: { value: 'USD' } }), list: vi.fn(), cdc: vi.fn().mockResolvedValue({ Invoice: [invoice()] }) });
        mocks.forOrg.mockResolvedValue(store());
        mocks.findLink.mockResolvedValue({ id: 1, remoteUpdatedAt: new Date('2026-10-02T00:00:00Z'), localHash: 'x', localCollection: 'receivables', localRecordId: 'qbo:123:7:invoice:10' });
        const result = await syncQuickBooks(
            { ...connector, config: { realmId: '123', environment: 'sandbox', lastCdcAt: new Date().toISOString(), financialSnapshotVersion: 1, financialSnapshotEntities: ['Invoice'] } },
            { filters: { entities: ['Invoice'] } }, { organizationId: 342, userId: 'system' }, 'knowledge_store');
        expect(result.mode).toBe('cdc');
        expect(mocks.addItems).not.toHaveBeenCalled();
    });
    it('falls back to a full pull when the CDC watermark is older than the lookback window', async () => {
        const list = vi.fn().mockResolvedValue({ items: [], nextStart: null });
        const cdc = vi.fn();
        mocks.clientFor.mockReturnValue({ company: vi.fn().mockResolvedValue({ HomeCurrency: { value: 'USD' } }), list, cdc });
        mocks.forOrg.mockResolvedValue(store());
        await syncQuickBooks(
            { ...connector, config: { realmId: '123', environment: 'sandbox', lastCdcAt: new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString() } },
            { filters: { entities: ['Invoice'] } }, { organizationId: 342, userId: 'system' }, 'knowledge_store');
        expect(list).toHaveBeenCalled();
        expect(cdc).not.toHaveBeenCalled();
    });
});

describe('QuickBooks webhook refresh', () => {
    it('does not delete a mirror when the API rejects a request or permission', async () => {
        mocks.clientFor.mockReturnValue({ company: vi.fn().mockResolvedValue({ HomeCurrency: { value: 'USD' } }), get: vi.fn().mockRejectedValue(new Error('QuickBooks rejected the accounting request. Review its fields and permissions.')) });
        mocks.forOrg.mockResolvedValue(store());
        await expect(refreshQuickBooksRecord(connector, 'Invoice', '10', { organizationId: 342 })).rejects.toThrow(/rejected/);
        expect(mocks.deleteLink).not.toHaveBeenCalled();
    });
    it('removes the mirror when the remote record is gone', async () => {
        mocks.clientFor.mockReturnValue({ company: vi.fn().mockResolvedValue({ HomeCurrency: { value: 'USD' } }), get: vi.fn().mockRejectedValue(new Error('QuickBooks request failed (404)')) });
        mocks.forOrg.mockResolvedValue(store());
        mocks.findLink.mockResolvedValue({ id: 1, localCollection: 'receivables', localRecordId: 'qbo:123:7:invoice:10' });
        const outcome = await refreshQuickBooksRecord(connector, 'Invoice', '10', { organizationId: 342 });
        expect(outcome).toBe('deleted');
        expect(mocks.deleteLink).toHaveBeenCalledWith(7, 'Invoice', '10', 342);
    });
    it('mirrors a fresh fetch and publishes the update', async () => {
        mocks.clientFor.mockReturnValue({ company: vi.fn().mockResolvedValue({ HomeCurrency: { value: 'USD' } }), get: vi.fn().mockResolvedValue(invoice()) });
        mocks.forOrg.mockResolvedValue(store());
        mocks.findLink.mockResolvedValue(null);
        const outcome = await refreshQuickBooksRecord(connector, 'Invoice', '10', { organizationId: 342 });
        expect(outcome).toBe('applied');
        expect(mocks.publish).toHaveBeenCalledWith('quickbooks.invoice_updated', expect.objectContaining({ remoteId: '10' }),
            expect.objectContaining({ organizationId: 342 }), 'quickbooks-sync');
    });
});


describe('Financial source snapshots', () => {
  it.each(['Invoice', 'Bill', 'Purchase', 'Payment', 'CreditMemo', 'VendorCredit', 'SalesReceipt', 'RefundReceipt', 'BillPayment', 'Deposit', 'Transfer', 'JournalEntry', 'PurchaseOrder', 'Account', 'Item', 'Customer', 'Vendor', 'Estimate'])('stores a current %s source record even without a BudgetMaster install', async entity => {
    mocks.findLink.mockResolvedValue(null);
    const record = { Id: '10', TotalAmt: 100, Balance: 40, CurrencyRef: { value: 'GBP' } };
    await applyQuickBooksRecord(connector, record, entity as any, 342, null, 'ctx');
    expect(mocks.upsertLink).toHaveBeenCalledWith(7, 342, expect.objectContaining({ remoteEntity: entity, remoteData: record }));
  });
  it('backfills missing snapshots even when the remote timestamp has not changed', async () => {
    mocks.findLink.mockResolvedValue({ remoteUpdatedAt: '2026-10-02T00:00:00Z', localCollection: 'dataset', localRecordId: 'qbo:123:7:bill:10' });
    await applyQuickBooksRecord(connector, invoice(), 'Bill', 342, null, 'ctx');
    expect(mocks.upsertLink).toHaveBeenCalledWith(7, 342, expect.objectContaining({ remoteData: invoice() }));
  });
});
