import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), get: vi.fn(), company: vi.fn(), create: vi.fn(), createCustomer: vi.fn(), createPayment: vi.fn(), voidInvoice: vi.fn(), link: vi.fn() }));
vi.mock('./service.js', async original => ({ ...(await original<any>()), getQuickBooksClient: mocks.resolve, upsertSyncLink: mocks.link }));
import { executeQuickBooksApproval } from '../../tools/v1/capabilities/quickbooks.js';
const args = { customer_id: '1', txn_date: '2026-10-08', connectorId: 7, realmId: '123', currency: 'USD', lines: [{ item_id: '2', quantity: 2, unit_price: 25 }] };
const client = () => ({ realmId: '123', get: mocks.get, company: mocks.company, createInvoice: mocks.create,
    createCustomer: mocks.createCustomer, createPayment: mocks.createPayment, voidInvoice: mocks.voidInvoice });
beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolve.mockResolvedValue({ connectorId: 7, client: client() });
    mocks.get.mockResolvedValue({ Active: true, CurrencyRef: { value: 'USD' } });
    mocks.company.mockResolvedValue({ HomeCurrency: { value: 'USD' } });
    mocks.create.mockResolvedValue({ Id: '10' });
    mocks.createCustomer.mockResolvedValue({ Id: '30', DisplayName: 'Ada' });
    mocks.createPayment.mockResolvedValue({ Id: '40' });
    mocks.voidInvoice.mockResolvedValue({ Id: '50', Balance: 0 });
});
describe('approved invoice accounting boundary', () => {
    it('creates only the approved invoice with a stable request identifier', async () => {
        await executeQuickBooksApproval('quickbooks_create_invoice', args, { organizationId: 342, projectId: 9, approvalRequestId: 42 });
        expect(mocks.resolve).toHaveBeenCalledWith(342, 9);
        expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ CustomerRef: { value: '1' }, CurrencyRef: { value: 'USD' }, Line: [expect.objectContaining({ Amount: 50 })] }), 'oddjob-approval-42');
    });
    it('refuses company changes and missing persisted approval IDs', async () => {
        await expect(executeQuickBooksApproval('quickbooks_create_invoice', { ...args, realmId: '999' }, { organizationId: 342, approvalRequestId: 42 })).rejects.toThrow(/company connection changed/);
        await expect(executeQuickBooksApproval('quickbooks_create_invoice', args, { organizationId: 342 })).rejects.toThrow(/approval ID/);
        expect(mocks.create).not.toHaveBeenCalled();
    });
    it('refuses currency changes and inactive source records', async () => {
        mocks.get.mockResolvedValueOnce({ Active: true, CurrencyRef: { value: 'EUR' } });
        await expect(executeQuickBooksApproval('quickbooks_create_invoice', args, { organizationId: 342, approvalRequestId: 42 })).rejects.toThrow(/currency changed/);
        mocks.get.mockResolvedValueOnce({ Active: false });
        await expect(executeQuickBooksApproval('quickbooks_create_invoice', args, { organizationId: 342, approvalRequestId: 42 })).rejects.toThrow(/no longer active/);
        expect(mocks.create).not.toHaveBeenCalled();
    });
    it('rejects impossible dates and reversed invoice deadlines', async () => {
        await expect(executeQuickBooksApproval('quickbooks_create_invoice', { ...args, txn_date: '2026-02-30' }, { organizationId: 342, approvalRequestId: 42 })).rejects.toThrow();
        await expect(executeQuickBooksApproval('quickbooks_create_invoice', { ...args, due_date: '2026-10-01' }, { organizationId: 342, approvalRequestId: 42 })).rejects.toThrow();
        expect(mocks.create).not.toHaveBeenCalled();
    });
    it('links approved invoices so inbound sync cannot duplicate them', async () => {
        await executeQuickBooksApproval('quickbooks_create_invoice', args, { organizationId: 342, approvalRequestId: 42 });
        expect(mocks.link).toHaveBeenCalledWith(7, 342, expect.objectContaining({ direction: 'out', remoteEntity: 'Invoice', remoteId: '10', localRecordId: 'qbo:123:7:invoice:10' }));
    });
    it('creates only the approved customer with a stable request identifier', async () => {
        await executeQuickBooksApproval('quickbooks_create_customer',
            { display_name: 'Ada Lovelace', email: 'ada@example.com', connectorId: 7, realmId: '123' }, { organizationId: 342, approvalRequestId: 42 });
        expect(mocks.createCustomer).toHaveBeenCalledWith(expect.objectContaining({ DisplayName: 'Ada Lovelace', PrimaryEmailAddr: { Address: 'ada@example.com' } }), 'oddjob-approval-42');
        expect(mocks.link).toHaveBeenCalledWith(7, 342, expect.objectContaining({ direction: 'out', remoteEntity: 'Customer', remoteId: '30' }));
    });
    it('records a payment against the approved invoice, never over its balance', async () => {
        mocks.get.mockResolvedValue({ Id: '50', DocNumber: 'INV-1', Balance: 100, CustomerRef: { value: '1' } });
        await executeQuickBooksApproval('quickbooks_record_payment',
            { invoice_id: '50', amount: 40, connectorId: 7, realmId: '123' }, { organizationId: 342, approvalRequestId: 42 });
        expect(mocks.createPayment).toHaveBeenCalledWith(expect.objectContaining({ TotalAmt: 40, CustomerRef: { value: '1' }, Line: [expect.objectContaining({ LinkedTxn: [{ TxnId: '50', TxnType: 'Invoice' }] })] }), 'oddjob-approval-42');
        await expect(executeQuickBooksApproval('quickbooks_record_payment',
            { invoice_id: '50', amount: 400, connectorId: 7, realmId: '123' }, { organizationId: 342, approvalRequestId: 42 })).rejects.toThrow(/exceeds the invoice balance/);
        mocks.get.mockResolvedValue({ Id: '50', Balance: 0 });
        await expect(executeQuickBooksApproval('quickbooks_record_payment',
            { invoice_id: '50', amount: 40, connectorId: 7, realmId: '123' }, { organizationId: 342, approvalRequestId: 42 })).rejects.toThrow(/no longer open/);
    });
    it('voids the approved invoice using its current sync token', async () => {
        mocks.get.mockResolvedValue({ Id: '50', TotalAmt: 100, Balance: 100, SyncToken: '3' });
        await executeQuickBooksApproval('quickbooks_void_invoice',
            { invoice_id: '50', connectorId: 7, realmId: '123' }, { organizationId: 342, approvalRequestId: 42 });
        expect(mocks.voidInvoice).toHaveBeenCalledWith('50', '3', 'oddjob-approval-42');
    });
    it('rejects unsupported actions before touching the company', async () => {
        await expect(executeQuickBooksApproval('quickbooks_delete_company', args, { organizationId: 342, approvalRequestId: 42 })).rejects.toThrow(/Unsupported/);
        expect(mocks.create).not.toHaveBeenCalled();
    });
});
