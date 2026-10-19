import { describe, expect, it } from 'vitest';
import { projectFinancialSnapshot, FINANCIAL_TYPES } from './financial-ontology';
import { QUICKBOOKS_ENTITIES } from '@domain/integrations/quickbooks/client';
const snapshot = (entity: string, record: any, connectorId = 7) => projectFinancialSnapshot({ connectorId, realmId: '123', entity, record });
describe('Financial relationships from source snapshots', () => {
  it('covers every supported source entity and keeps company/connection identities distinct', () => {
    for (const entity of QUICKBOOKS_ENTITIES) expect(FINANCIAL_TYPES.some(t => t.name === `QuickBooks ${entity}`)).toBe(true);
    expect(snapshot('Invoice', { Id: '1' }).record.id).not.toBe(snapshot('Invoice', { Id: '1' }, 8).record.id);
  });
  it('preserves amounts, subtotal and discount types, item relationships and tax without double counting', () => {
    const item = snapshot('Invoice', { Id: '1', TotalAmt: 99, Balance: 40, CurrencyRef: { value: 'USD' }, CustomerRef: { value: '2' }, TxnTaxDetail: { TotalTax: 4 }, Line: [
      { Id: '1', Amount: 100, DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: '3' }, Qty: 2, UnitPrice: 50 } },
      { Id: '2', Amount: 100, DetailType: 'SubTotalLineDetail' }, { Id: '3', Amount: 5, DetailType: 'DiscountLineDetail' },
    ] });
    expect(item.record).toMatchObject({ TotalAmt: 99, Balance: 40, currency: 'USD', customerId: 'qbo:123:7:customer:2', tax: 4 });
    expect(item.lines[0]).toMatchObject({ itemId: 'qbo:123:7:item:3', UnitPrice: 50 });
    expect(item.lines[1].isSubtotal).toBe(true);
    expect(item.lines[2].signedAmount).toBe(-5);
  });
  it.each(['Payment', 'CreditMemo', 'BillPayment', 'VendorCredit'])('retains %s allocation relationships and refuses to infer multi-target shares', entity => {
    const item = snapshot(entity, { Id: '9', CurrencyRef: { value: 'USD' }, Line: [
      { Amount: 40, LinkedTxn: [{ TxnType: 'Invoice', TxnId: '1' }] },
      { Amount: 100, LinkedTxn: [{ TxnType: 'Bill', TxnId: '2' }, { TxnType: 'Bill', TxnId: '3' }] },
    ] });
    expect(item.allocations[0]).toMatchObject({ sourceId: `qbo:123:7:${entity.toLowerCase()}:9`, targetId: 'qbo:123:7:invoice:1', Amount: 40 });
    expect(item.allocations[1]).toMatchObject({ Amount: null, sharedLine: true });
  });
});
