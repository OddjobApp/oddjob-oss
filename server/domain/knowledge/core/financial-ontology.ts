import { and, eq } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { saasSyncLinks, saasConnectors } from '@shared/schema/integrations.js';
import type { OntologyAdapter } from './ontology-adapters.js';
import { UnfilterablePropertyError } from './ontology-adapter-errors.js';
import type { OntologyCtx } from './ontology.service.js';
import { QUICKBOOKS_ENTITIES } from '@domain/integrations/quickbooks/client.js';
import { financeRolesService } from '@domain/projects/core/finance-roles.service.js';

export const FINANCIAL_TYPES = [
  { name: 'Financial Record', adapter: 'financial_records', description: 'Latest source-scoped accounting record; choose monetary fields explicitly and preserve its currency.' },
  { name: 'Financial Line', adapter: 'financial_lines', description: 'A typed accounting line, including sales, expenses, subtotal, tax and discount. Subtotals are not additional charges.' },
  { name: 'Financial Allocation', adapter: 'financial_allocations', description: 'An application of a payment or credit to another source transaction; ambiguous multi-target allocations have no inferred amount.' },
  { name: 'Financial Currency', adapter: 'financial_currencies', description: 'A verified currency unit. Monetary calculations never combine currencies implicitly.' },
  ...QUICKBOOKS_ENTITIES.map(entity => ({ name: `QuickBooks ${entity}`, adapter: `financial_${entity.toLowerCase()}`, description: `Latest QuickBooks ${entity} with source identity, currency and typed relationships.` })),
];
export const FINANCIAL_LINKS = [
  ...['Financial Record', ...QUICKBOOKS_ENTITIES.map(e => `QuickBooks ${e}`)].flatMap(sourceType => [
    { sourceType, name: 'customer', inverseName: `${sourceType.toLowerCase().replace(/ /g, '_')}_customer_records`, targetType: 'Financial Record', sourceProperty: 'customerId', cardinality: 'one_to_one' as const, description: 'The customer in the same source company and connection.' },
    { sourceType, name: 'vendor', inverseName: `${sourceType.toLowerCase().replace(/ /g, '_')}_vendor_records`, targetType: 'Financial Record', sourceProperty: 'vendorId', cardinality: 'one_to_one' as const, description: 'The vendor in the same source company and connection.' },
    { sourceType, name: 'account', inverseName: `${sourceType.toLowerCase().replace(/ /g, '_')}_account_records`, targetType: 'Financial Record', sourceProperty: 'accountId', cardinality: 'one_to_one' as const, description: 'The source accounting account.' },
    { sourceType, name: 'currency', inverseName: `${sourceType.toLowerCase().replace(/ /g, '_')}_currency_records`, targetType: 'Financial Currency', sourceProperty: 'currency', cardinality: 'one_to_one' as const, description: 'The verified source currency; unknown currency is not USD.' },
  ]),
  { sourceType: 'Financial Line', name: 'record', inverseName: 'lines', targetType: 'Financial Record', sourceProperty: 'recordId', cardinality: 'one_to_one' as const, description: 'The accounting document containing this line.' },
  { sourceType: 'Financial Line', name: 'item', inverseName: 'item_lines', targetType: 'Financial Record', sourceProperty: 'itemId', cardinality: 'one_to_one' as const, description: 'The source item sold or purchased.' },
  { sourceType: 'Financial Line', name: 'account', inverseName: 'account_lines', targetType: 'Financial Record', sourceProperty: 'accountId', cardinality: 'one_to_one' as const, description: 'The accounting account assigned to this line.' },
  { sourceType: 'Financial Allocation', name: 'source', inverseName: 'allocations', targetType: 'Financial Record', sourceProperty: 'sourceId', cardinality: 'one_to_one' as const, description: 'The payment, credit or transaction applying the allocation.' },
  { sourceType: 'Financial Allocation', name: 'target', inverseName: 'applied_allocations', targetType: 'Financial Record', sourceProperty: 'targetId', cardinality: 'one_to_one' as const, description: 'The invoice, bill or other transaction receiving the allocation.' },
];

export function projectFinancialSnapshot(snapshot: { connectorId: number; realmId: string; entity: string; record: any; homeCurrency?: string }) {
  const { connectorId, realmId, entity, record } = snapshot;
  const key = (type: string, id: unknown) => id == null ? null : `qbo:${realmId}:${connectorId}:${type.toLowerCase()}:${id}`;
  const id = key(entity, record.Id)!;
  const currency = record.CurrencyRef?.value ?? snapshot.homeCurrency ?? null;
  const lineRows: Record<string, any>[] = [];
  const allocations: Record<string, any>[] = [];
  const visit = (lines: any[], prefix = '') => lines.forEach((line, index) => {
    const lineKey = `${prefix}${line.Id ?? index}`;
    const detail = line[line.DetailType] ?? {};
    const itemRef = detail.ItemRef;
    lineRows.push({ id: `${id}:line:${lineKey}`, name: line.Description ?? line.DetailType ?? 'Line', recordId: id,
      entity, detailType: line.DetailType, currency, Amount: line.Amount ?? null,
      signedAmount: line.Amount == null ? null : line.DetailType === 'DiscountLineDetail' ? -Number(line.Amount) : line.Amount,
      isSubtotal: line.DetailType === 'SubTotalLineDetail', itemId: key('Item', itemRef?.value),
      accountId: key('Account', detail.AccountRef?.value ?? detail.ItemAccountRef?.value), quantity: detail.Qty ?? null, UnitPrice: detail.UnitPrice ?? null });
    (line.LinkedTxn ?? []).forEach((txn: any, i: number) => allocations.push({ id: `${id}:allocation:${lineKey}:${i}`, name: 'Transaction allocation',
      sourceId: id, targetId: key(txn.TxnType, txn.TxnId), currency, Amount: line.LinkedTxn.length === 1 ? line.Amount ?? null : null,
      sharedLine: line.LinkedTxn.length > 1 }));
    if (detail.Line) visit(detail.Line, `${lineKey}:`);
  });
  visit(record.Line ?? []);
  if (record.TxnTaxDetail?.TotalTax != null) lineRows.push({ id: `${id}:tax`, name: 'Tax total', recordId: id, entity, detailType: 'TaxSummary', currency, Amount: record.TxnTaxDetail.TotalTax, isSubtotal: true });
  return {
    record: { ...record, id, name: record.DisplayName ?? record.Name ?? record.DocNumber ?? `${entity} ${record.Id}`, entity, currency, homeCurrency: snapshot.homeCurrency ?? null,
      connectorId, realmId, remoteId: String(record.Id), customerId: key('Customer', record.CustomerRef?.value),
      vendorId: key('Vendor', record.VendorRef?.value ?? (record.EntityRef?.type === 'Vendor' ? record.EntityRef.value : null)),
      accountId: key('Account', record.AccountRef?.value ?? record.DepositToAccountRef?.value),
      TotalAmt: record.TotalAmt ?? null, Balance: record.Balance ?? record.CurrentBalance ?? null, CurrentBalance: record.CurrentBalance ?? null,
      UnitPrice: record.UnitPrice ?? null, PurchaseCost: record.PurchaseCost ?? null, UnappliedAmt: record.UnappliedAmt ?? null,
      Amount: record.Amount ?? null, HomeTotalAmt: record.HomeTotalAmt ?? null, tax: record.TxnTaxDetail?.TotalTax ?? null },
    lines: lineRows, allocations,
  };
}
const recordProperties = { id: 'string', name: 'string', entity: 'string', currency: 'string', homeCurrency: 'string', connectorId: 'integer', realmId: 'string', remoteId: 'string', customerId: 'string', vendorId: 'string', accountId: 'string', TotalAmt: 'number', Balance: 'number', CurrentBalance: 'number', UnitPrice: 'number', PurchaseCost: 'number', UnappliedAmt: 'number', tax: 'number', Amount: 'number', HomeTotalAmt: 'number' };
const properties: Record<string, Record<string, string>> = {
  records: recordProperties,
  lines: { id: 'string', name: 'string', recordId: 'string', entity: 'string', currency: 'string', detailType: 'string', Amount: 'number', signedAmount: 'number', isSubtotal: 'boolean', itemId: 'string', accountId: 'string', quantity: 'number', UnitPrice: 'number' },
  allocations: { id: 'string', name: 'string', sourceId: 'string', targetId: 'string', currency: 'string', Amount: 'number', sharedLine: 'boolean' },
  currencies: { id: 'string', name: 'string' },
};
async function objects(ctx: OntologyCtx, kind: string, entity?: string): Promise<Record<string, any>[]> {
  if (!Number.isInteger(ctx.organizationId) || ctx.organizationId <= 0) throw new Error('Financial ontology requires an organization.');
  const all = await db.select({ entity: saasSyncLinks.remoteEntity, record: saasSyncLinks.remoteData, connectorId: saasSyncLinks.connectorId, config: saasConnectors.config, connectorProjectId: saasConnectors.projectId })
    .from(saasSyncLinks).innerJoin(saasConnectors, and(eq(saasSyncLinks.connectorId, saasConnectors.id), eq(saasConnectors.orgId, ctx.organizationId)))
    .where(and(eq(saasSyncLinks.orgId, ctx.organizationId), eq(saasConnectors.platform, 'quickbooks'), ...(entity ? [eq(saasSyncLinks.remoteEntity, entity)] : [])))
    .orderBy(saasSyncLinks.id).limit(10001);
  if (all.length > 10000) throw new Error('Financial ontology exceeds 10,000 snapshots; narrow the object type.');
  // Only the record types the caller's finance roles may read (shared/finance-roles.ts):
  // a project connection by that project's roles, an org-wide one by the union of
  // the caller's roles. No user, or no finance role, sees no financial objects.
  const readable = await financeRolesService.readableEntities(ctx.organizationId, ctx.userId);
  const rows = all.filter(row => readable(row.connectorProjectId ?? null)(row.entity));
  if (rows.some(row => !row.record)) throw new Error('Financial source snapshots are missing. Run QuickBooks sync before using the financial ontology.');
  const projected = rows.map(row => projectFinancialSnapshot({ ...row, realmId: String((row.config as any)?.realmId), homeCurrency: (row.config as any)?.homeCurrency, record: row.record }));
  if (kind === 'currencies') return [...new Set(projected.map(p => p.record.currency).filter(c => typeof c === 'string' && /^[A-Z]{3}$/.test(c)))].map(id => ({ id, name: id }));
  return projected.flatMap(p => kind === 'lines' ? p.lines : kind === 'allocations' ? p.allocations : [p.record]);
}
function adapter(kind: string, entity?: string): OntologyAdapter {
  const schema = properties[kind];
  return { properties: schema, titleProperty: 'name',
    async list(ctx, opts) { return (await objects(ctx, kind, entity)).slice(0, Math.min(Math.max(opts?.limit ?? 50, 1), 200)); },
    async get(ctx, id) { return (await objects(ctx, kind, entity)).find(row => row.id === String(id)) ?? null; },
    async listBy(ctx, property, value) {
      if (!Object.prototype.hasOwnProperty.call(schema, property)) throw new UnfilterablePropertyError(property, Object.keys(schema));
      return (await objects(ctx, kind, entity)).filter(row => row[property] != null && String(row[property]) === String(value));
    },
  };
}
export const FINANCIAL_ADAPTERS: Record<string, OntologyAdapter> = {
  financial_records: adapter('records'), financial_lines: adapter('lines'), financial_allocations: adapter('allocations'), financial_currencies: adapter('currencies'),
  ...Object.fromEntries(QUICKBOOKS_ENTITIES.map(entity => [`financial_${entity.toLowerCase()}`, adapter('records', entity)])),
};
