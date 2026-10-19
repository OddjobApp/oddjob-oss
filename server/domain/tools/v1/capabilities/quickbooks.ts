import { calculateQuickBooksTotal, FINANCIAL_FIELDS } from '@domain/integrations/quickbooks/financial-calculations.js';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { ToolContext, ToolDefinition } from './types.js';
import { getQuickBooksClient, upsertSyncLink, quickBooksRecordKey } from '@domain/integrations/quickbooks/service.js';
import { QUICKBOOKS_ENTITIES, QUICKBOOKS_REPORTS } from '@domain/integrations/quickbooks/client.js';
import { executiveApproverAddress, financeRolesService } from '@domain/projects/core/finance-roles.service.js';
import { requiresExecutiveApproval, type FinanceOp } from '@shared/finance-roles.js';

const id = z.string().regex(/^\d{1,30}$/, 'QuickBooks numeric record ID');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const d = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}, 'Use a real YYYY-MM-DD date');
const invoiceSchema = z.object({ customer_id: id, txn_date: date, due_date: date.optional(), note: z.string().max(1000).optional(),
    lines: z.array(z.object({ item_id: id, description: z.string().max(500).optional(), quantity: z.number().positive().max(1_000_000), unit_price: z.number().nonnegative().max(1_000_000) })).min(1).max(50),
}).refine(p => !p.due_date || p.due_date >= p.txn_date, 'Due date cannot precede invoice date')
    .refine(p => p.lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unit_price * 100) / 100, 0) <= 1_000_000_000, 'Invoice amount exceeds the supported limit.');
const customerSchema = z.object({ display_name: z.string().min(1).max(500), company_name: z.string().max(500).optional(),
    email: z.string().email().max(100).optional(), phone: z.string().max(30).optional(), note: z.string().max(1000).optional() });
const paymentSchema = z.object({ invoice_id: id, amount: z.number().positive().max(1_000_000_000), txn_date: date.optional(), note: z.string().max(1000).optional() });
const voidSchema = z.object({ invoice_id: id });

/** The finance permission each approval-gated write needs (shared/finance-roles.ts). */
export const QUICKBOOKS_WRITE_PERMISSIONS: Record<string, { entity: string; op: FinanceOp }> = {
    quickbooks_create_invoice: { entity: 'Invoice', op: 'create' },
    quickbooks_create_customer: { entity: 'Customer', op: 'create' },
    quickbooks_record_payment: { entity: 'Payment', op: 'create' },
    quickbooks_void_invoice: { entity: 'Invoice', op: 'delete' },
};

/** Refuses before QuickBooks is contacted when the caller's finance roles do not allow the write. */
async function assertMayPropose(actionName: string, context: ToolContext) {
    const { entity, op } = QUICKBOOKS_WRITE_PERMISSIONS[actionName];
    const { projectId } = await financeRolesService.assertCan(context, entity, op);
    return projectId;
}

/**
 * Saves the review card. It goes to the proposer, who holds the permission; a
 * write the matrix also gives an Executive (a void, a refund, money going out)
 * goes to the project's Executives instead, and its proposer cannot approve it.
 * `permissionProjectId` and `proposedBy` are what the approval gate re-checks.
 */
async function saveProposal(toolName: string, meta: Record<string, any>, context: ToolContext, permissionProjectId: number | null) {
    const { db } = await import('@server/database_service.js');
    const { approvalRequests } = await import('@shared/schema/index.js');
    const userId = String(context.userId);
    const { entity, op } = QUICKBOOKS_WRITE_PERMISSIONS[meta.actionName];
    const needsExecutive = requiresExecutiveApproval(entity, op);
    if (needsExecutive && permissionProjectId == null) throw new Error('This QuickBooks change needs an Executive approver, and no project is in scope.');
    Object.assign(meta, { permissionProjectId, proposedBy: userId, needsExecutiveApproval: needsExecutive });
    const approver = needsExecutive
        ? { approverEmail: executiveApproverAddress(permissionProjectId!) }
        : { approverEmail: userId, ...(/^[0-9a-f-]{36}$/i.test(userId) ? { approverId: userId } : {}) };
    const [row] = await db.insert(approvalRequests).values({ executionId: `quickbooks_${randomBytes(16).toString('hex')}`, toolName,
        toolArgs: meta, organizationId: context.organizationId, approverType: 'user', ...approver,
        token: randomBytes(24).toString('hex'), status: 'pending' }).returning({ id: approvalRequests.id });
    if (!row) throw new Error('Could not save the proposal.');
    return row.id;
}

async function proposedInvoice(args: unknown, context: ToolContext) {
    if (context.organizationId == null || !context.userId) throw new Error('An organization and user are required to propose an invoice.');
    const permissionProjectId = await assertMayPropose('quickbooks_create_invoice', context);
    const p = invoiceSchema.parse(args);
    const { connectorId, client } = await getQuickBooksClient(context.organizationId, context.projectId);
    const customer = await client.get('Customer', p.customer_id);
    if (!customer || customer.Active === false) throw new Error('Choose an active QuickBooks customer.');
    const company = await client.company();
    for (const itemId of new Set(p.lines.map(l => l.item_id))) {
        const item = await client.get('Item', itemId);
        if (!item || item.Active === false) throw new Error('Choose active QuickBooks invoice items.');
    }
    const total = p.lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unit_price * 100) / 100, 0);
    if (!Number.isFinite(total) || total > 1_000_000_000) throw new Error('Invoice amount exceeds the supported limit.');
    const meta = { type: 'approval_request', kind: 'quickbooks_action', actionName: 'quickbooks_create_invoice',
        args: { ...p, connectorId, realmId: client.realmId, currency: customer.CurrencyRef?.value ?? company?.HomeCurrency?.value ?? null },
        title: `Create invoice for ${customer.DisplayName}`, reason: 'Create an unpaid invoice in QuickBooks Online. This does not email it or collect payment.',
        summary: { customer: customer.DisplayName, company: company?.CompanyName, subtotal: total, currency: customer.CurrencyRef?.value ?? company?.HomeCurrency?.value ?? 'Company currency', lineCount: p.lines.length },
        projectId: context.projectId ?? null, status: 'pending' };
    const proposalId = await saveProposal('quickbooks_propose_invoice', meta, context, permissionProjectId);
    return JSON.stringify({ ...meta, proposalId });
}

async function proposedCustomer(args: unknown, context: ToolContext) {
    if (context.organizationId == null || !context.userId) throw new Error('An organization and user are required to propose a customer.');
    const permissionProjectId = await assertMayPropose('quickbooks_create_customer', context);
    const p = customerSchema.parse(args);
    const { connectorId, client } = await getQuickBooksClient(context.organizationId, context.projectId);
    const company = await client.company();
    const meta = { type: 'approval_request', kind: 'quickbooks_action', actionName: 'quickbooks_create_customer',
        args: { ...p, connectorId, realmId: client.realmId },
        title: `Create customer ${p.display_name}`, reason: 'Create a new customer in QuickBooks Online.',
        summary: { customer: p.display_name, company: company?.CompanyName, email: p.email ?? null, companyName: p.company_name ?? null },
        projectId: context.projectId ?? null, status: 'pending' };
    const proposalId = await saveProposal('quickbooks_propose_customer', meta, context, permissionProjectId);
    return JSON.stringify({ ...meta, proposalId });
}

async function proposedPayment(args: unknown, context: ToolContext) {
    if (context.organizationId == null || !context.userId) throw new Error('An organization and user are required to propose a payment.');
    const permissionProjectId = await assertMayPropose('quickbooks_record_payment', context);
    const p = paymentSchema.parse(args);
    const { connectorId, client } = await getQuickBooksClient(context.organizationId, context.projectId);
    const invoice = await client.get('Invoice', p.invoice_id);
    const balance = Math.round((Number(invoice?.Balance) || 0) * 100) / 100;
    if (!invoice || balance <= 0) throw new Error('Choose an open QuickBooks invoice with an outstanding balance.');
    if (p.amount > balance) throw new Error(`Payment ${p.amount} exceeds the invoice balance of ${balance}.`);
    const company = await client.company();
    const meta = { type: 'approval_request', kind: 'quickbooks_action', actionName: 'quickbooks_record_payment',
        args: { ...p, connectorId, realmId: client.realmId },
        title: `Record payment of ${p.amount} against invoice ${invoice.DocNumber ?? invoice.Id}`,
        reason: 'Record a customer payment in QuickBooks Online. This marks the invoice paid in whole or part; it does not move money.',
        summary: { customer: invoice.CustomerRef?.name ?? 'QuickBooks customer', company: company?.CompanyName,
            invoice: invoice.DocNumber ?? invoice.Id, amount: p.amount, balance, currency: invoice.CurrencyRef?.value ?? company?.HomeCurrency?.value ?? 'Company currency' },
        projectId: context.projectId ?? null, status: 'pending' };
    const proposalId = await saveProposal('quickbooks_propose_payment', meta, context, permissionProjectId);
    return JSON.stringify({ ...meta, proposalId });
}

async function proposedVoid(args: unknown, context: ToolContext) {
    if (context.organizationId == null || !context.userId) throw new Error('An organization and user are required to propose a void.');
    const permissionProjectId = await assertMayPropose('quickbooks_void_invoice', context);
    const p = voidSchema.parse(args);
    const { connectorId, client } = await getQuickBooksClient(context.organizationId, context.projectId);
    const invoice = await client.get('Invoice', p.invoice_id);
    if (!invoice) throw new Error('Choose an existing QuickBooks invoice.');
    if (Number(invoice.TotalAmt) === 0 && Number(invoice.Balance) === 0) throw new Error('This invoice is already voided.');
    const company = await client.company();
    const meta = { type: 'approval_request', kind: 'quickbooks_action', actionName: 'quickbooks_void_invoice',
        args: { ...p, connectorId, realmId: client.realmId },
        title: `Void invoice ${invoice.DocNumber ?? invoice.Id}`,
        reason: 'Void an invoice in QuickBooks Online — its amounts are zeroed but the record remains for audit. This cannot be undone.',
        summary: { customer: invoice.CustomerRef?.name ?? 'QuickBooks customer', company: company?.CompanyName,
            invoice: invoice.DocNumber ?? invoice.Id, total: Number(invoice.TotalAmt) || 0, balance: Number(invoice.Balance) || 0,
            currency: invoice.CurrencyRef?.value ?? company?.HomeCurrency?.value ?? 'Company currency' },
        projectId: context.projectId ?? null, status: 'pending' };
    const proposalId = await saveProposal('quickbooks_propose_void_invoice', meta, context, permissionProjectId);
    return JSON.stringify({ ...meta, proposalId });
}

export async function executeQuickBooksApproval(action: string, args: unknown, context: ToolContext) {
    const stored = z.object({ connectorId: z.number().int().positive(), realmId: id, currency: z.string().regex(/^[A-Z]{3}$/).nullish() }).parse(args);
    const { connectorId, client } = await getQuickBooksClient(context.organizationId, context.projectId);
    if (connectorId !== stored.connectorId || client.realmId !== stored.realmId) throw new Error('QuickBooks company connection changed. Raise a new invoice proposal.');
    const requestId = context.approvalRequestId;
    if (!Number.isInteger(requestId) || Number(requestId) <= 0) throw new Error('A persisted approval ID is required to create an invoice.');

    const linkCreated = async (entity: string, remote: any, localCollection: string) => {
        if (context.organizationId == null || !remote?.Id) return;
        await upsertSyncLink(connectorId, context.organizationId, {
            direction: 'out', localCollection, localRecordId: quickBooksRecordKey({ id: connectorId, config: { realmId: client.realmId } }, entity, String(remote.Id)),
            remoteEntity: entity, remoteId: String(remote.Id), remoteData: remote, remoteSyncToken: remote.SyncToken ?? null,
            remoteUpdatedAt: remote.MetaData?.LastUpdatedTime ? new Date(remote.MetaData.LastUpdatedTime) : null,
        });
    };

    if (action === 'quickbooks_create_invoice') {
        const p = invoiceSchema.parse(args);
        const customer = await client.get('Customer', p.customer_id);
        if (!customer || customer.Active === false) throw new Error('The approved customer is no longer active.');
        const company = await client.company();
        if ((customer.CurrencyRef?.value ?? company?.HomeCurrency?.value ?? null) !== stored.currency) throw new Error('Invoice currency changed. Raise a new proposal.');
        for (const itemId of new Set(p.lines.map(l => l.item_id))) {
            const item = await client.get('Item', itemId);
            if (!item || item.Active === false) throw new Error('An approved invoice item is no longer active.');
        }
        const invoice = await client.createInvoice({ CustomerRef: { value: p.customer_id }, ...(stored.currency ? { CurrencyRef: { value: stored.currency } } : {}), TxnDate: p.txn_date, ...(p.due_date ? { DueDate: p.due_date } : {}),
            ...(p.note ? { PrivateNote: p.note } : {}), Line: p.lines.map(l => ({ Amount: Math.round(l.quantity * l.unit_price * 100) / 100,
                DetailType: 'SalesItemLineDetail', ...(l.description ? { Description: l.description } : {}),
                SalesItemLineDetail: { ItemRef: { value: l.item_id }, Qty: l.quantity, UnitPrice: l.unit_price } })) }, `oddjob-approval-${requestId}`);
        await linkCreated('Invoice', invoice, 'receivables');
        return invoice;
    }
    if (action === 'quickbooks_create_customer') {
        const p = customerSchema.parse(args);
        const customer = await client.createCustomer({ DisplayName: p.display_name, ...(p.company_name ? { CompanyName: p.company_name } : {}),
            ...(p.email ? { PrimaryEmailAddr: { Address: p.email } } : {}), ...(p.phone ? { PrimaryPhone: { FreeFormNumber: p.phone } } : {}),
            ...(p.note ? { Notes: p.note } : {}) }, `oddjob-approval-${requestId}`);
        await linkCreated('Customer', customer, 'dataset');
        return customer;
    }
    if (action === 'quickbooks_record_payment') {
        const p = paymentSchema.parse(args);
        const invoice = await client.get('Invoice', p.invoice_id);
        const balance = Math.round((Number(invoice?.Balance) || 0) * 100) / 100;
        if (!invoice || balance <= 0) throw new Error('The approved invoice is no longer open.');
        if (p.amount > balance) throw new Error(`Payment ${p.amount} exceeds the invoice balance of ${balance}.`);
        const payment = await client.createPayment({ CustomerRef: { value: invoice.CustomerRef.value }, TotalAmt: p.amount,
            ...(p.txn_date ? { TxnDate: p.txn_date } : {}), ...(p.note ? { PrivateNote: p.note } : {}),
            Line: [{ Amount: p.amount, LinkedTxn: [{ TxnId: p.invoice_id, TxnType: 'Invoice' }] }] }, `oddjob-approval-${requestId}`);
        await linkCreated('Payment', payment, 'transactions');
        return payment;
    }
    if (action === 'quickbooks_void_invoice') {
        const p = voidSchema.parse(args);
        const invoice = await client.get('Invoice', p.invoice_id);
        if (!invoice) throw new Error('The approved invoice no longer exists.');
        if (Number(invoice.TotalAmt) === 0 && Number(invoice.Balance) === 0) throw new Error('The approved invoice is already voided.');
        const voided = await client.voidInvoice(String(invoice.Id), String(invoice.SyncToken ?? ''), `oddjob-approval-${requestId}`);
        return voided;
    }
    throw new Error('Unsupported QuickBooks write action.');
}

export const QUICKBOOKS_TOOLS: Record<string, ToolDefinition> = {
    quickbooks_calculate_total: { name: 'quickbooks_calculate_total', label: 'Calculate QuickBooks total', group: 'Accounting', riskLevel: 'low', idempotency: 'read-safe',
        description: 'Calculate an exact monetary sum across ALL pages of supported QuickBooks records. Specify the monetary field explicitly. Outstanding invoices mean entity Invoice, field Balance, outstanding true; original invoice amounts use TotalAmt. Results are separate per verified currency. Missing values and incomplete paging fail instead of reporting misleading totals.',
        parameters: z.object({ entity: z.enum(QUICKBOOKS_ENTITIES), field: z.enum(FINANCIAL_FIELDS), outstanding: z.boolean().optional(), overdue: z.boolean().optional() }),
        execute: async (p, c) => {
            await financeRolesService.assertCan(c, p.entity, 'read');
            return JSON.stringify(await calculateQuickBooksTotal((await getQuickBooksClient(c.organizationId, c.projectId)).client, p));
        } },
    quickbooks_get_company: { name: 'quickbooks_get_company', label: 'QuickBooks company', group: 'Accounting', riskLevel: 'low', idempotency: 'read-safe',
        description: 'Read the connected QuickBooks Online company. Missing connections can be requested with connect_platform platform quickbooks.',
        parameters: z.object({}), execute: async (_, c) => {
            await financeRolesService.assertAnyRole(c);
            return JSON.stringify({ entity: 'CompanyInfo', items: [await (await getQuickBooksClient(c.organizationId, c.projectId)).client.company()] });
        } },
    quickbooks_list_records: { name: 'quickbooks_list_records', label: 'Find QuickBooks records', group: 'Accounting', riskLevel: 'low', idempotency: 'read-safe',
        description: 'Read customers, vendors, accounts, items, invoices, bills, purchases, payments or estimates. For outstanding/unpaid invoices use entity Invoice and outstanding true; for overdue invoices use overdue true. OutstandingInvoices is not a report name. Supports bounded pagination and name/document-number search. No accounting data is changed.',
        parameters: z.object({ entity: z.enum(QUICKBOOKS_ENTITIES), start: z.number().int().min(1).max(1_000_000).default(1), limit: z.number().int().min(1).max(100).default(25), search: z.string().max(100).optional(), overdue: z.boolean().optional(), outstanding: z.boolean().optional() }),
        execute: async (p, c) => {
            await financeRolesService.assertCan(c, p.entity, 'read');
            return JSON.stringify(await (await getQuickBooksClient(c.organizationId, c.projectId)).client.list(p.entity, p));
        } },
    quickbooks_get_record: { name: 'quickbooks_get_record', label: 'Read QuickBooks record', group: 'Accounting', riskLevel: 'low', idempotency: 'read-safe',
        description: 'Read the full selected accounting record by its entity and numeric ID from the same scoped QuickBooks connection.',
        parameters: z.object({ entity: z.enum(QUICKBOOKS_ENTITIES), id }), execute: async (p, c) => {
            await financeRolesService.assertCan(c, p.entity, 'read');
            return JSON.stringify({ entity: p.entity, items: [await (await getQuickBooksClient(c.organizationId, c.projectId)).client.get(p.entity, p.id)] });
        } },
    quickbooks_get_report: { name: 'quickbooks_get_report', label: 'QuickBooks financial report', group: 'Accounting', riskLevel: 'low', idempotency: 'read-safe',
        description: 'Read profit and loss, balance sheet, cash flow, aged receivables or aged payables from QuickBooks Online. Report values are source data, not financial advice.',
        parameters: z.object({ report: z.enum(QUICKBOOKS_REPORTS), start_date: date.optional(), end_date: date.optional() }).refine(p => !p.start_date || !p.end_date || p.start_date <= p.end_date, 'Report dates are reversed'),
        execute: async (p, c) => {
            await financeRolesService.assertCanReport(c, p.report);
            return JSON.stringify(await (await getQuickBooksClient(c.organizationId, c.projectId)).client.report(p.report, { start_date: p.start_date, end_date: p.end_date }));
        } },
    quickbooks_propose_invoice: { name: 'quickbooks_propose_invoice', label: 'Propose QuickBooks invoice', group: 'Accounting', riskLevel: 'low', idempotency: 'none',
        description: 'Save a review card for an invoice using actual QuickBooks customer and item IDs. Only authenticated approval creates the unpaid invoice. This does not email it, take payment or edit existing accounting records.',
        parameters: invoiceSchema, execute: proposedInvoice },
    quickbooks_propose_customer: { name: 'quickbooks_propose_customer', label: 'Propose QuickBooks customer', group: 'Accounting', riskLevel: 'low', idempotency: 'none',
        description: 'Save a review card for a new QuickBooks customer. Only authenticated approval creates the customer record.',
        parameters: customerSchema, execute: proposedCustomer },
    quickbooks_propose_payment: { name: 'quickbooks_propose_payment', label: 'Propose QuickBooks payment', group: 'Accounting', riskLevel: 'low', idempotency: 'none',
        description: 'Save a review card for a customer payment against an open QuickBooks invoice. Only authenticated approval records the payment; it does not move money.',
        parameters: paymentSchema, execute: proposedPayment },
    quickbooks_propose_void_invoice: { name: 'quickbooks_propose_void_invoice', label: 'Propose voiding a QuickBooks invoice', group: 'Accounting', riskLevel: 'low', idempotency: 'none',
        description: 'Save a review card to void an existing QuickBooks invoice. Only authenticated approval voids it; the record stays for audit but its amounts are zeroed and this cannot be undone.',
        parameters: voidSchema, execute: proposedVoid },
};
