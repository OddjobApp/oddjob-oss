import { describe, expect, it, vi } from 'vitest';
import { calculateQuickBooksTotal } from './financial-calculations';
import { sumMoney } from '@shared/financial-money';
const row = (Id: string, Balance: unknown, currency = 'USD') => ({ Id, TotalAmt: 100, Balance, CurrencyRef: { value: currency } });
describe('Financial totals over source records', () => {
  it('sums balances across every page without including invoice totals or mixing currencies', async () => {
    const client = { company: vi.fn(), list: vi.fn().mockResolvedValueOnce({ items: [row('1', 0.1), row('2', 0.2)], nextStart: 3 }).mockResolvedValueOnce({ items: [row('3', 12.5, 'EUR')], nextStart: null }) };
    const result = await calculateQuickBooksTotal(client as any, { entity: 'Invoice', field: 'Balance', outstanding: true });
    expect(result).toMatchObject({ complete: true, matchedRecords: 3, totals: [{ currency: 'USD', value: '0.30', count: 2 }, { currency: 'EUR', value: '12.50', count: 1 }] });
    expect(client.list.mock.calls[1][1]).toMatchObject({ start: 3, outstanding: true });
  });
  it.each(['Bill', 'Purchase', 'Payment', 'CreditMemo', 'VendorCredit', 'SalesReceipt', 'RefundReceipt', 'BillPayment', 'Deposit', 'PurchaseOrder'])('totals %s in verified company currency when the source omits CurrencyRef', async entity => {
    const client = { company: vi.fn().mockResolvedValue({ HomeCurrency: { value: 'GBP' } }), list: vi.fn().mockResolvedValue({ items: [{ Id: '1', TotalAmt: '50.10' }, { Id: '2', TotalAmt: '-10.00' }], nextStart: null }) };
    expect((await calculateQuickBooksTotal(client as any, { entity: entity as any, field: 'TotalAmt' })).totals[0].value).toBe('40.10');
    expect(client.company).toHaveBeenCalledTimes(1);
  });
  it('reads explicitly selected nested tax values', async () => {
    const client = { company: vi.fn(), list: vi.fn().mockResolvedValue({ items: [{ Id: '1', CurrencyRef: { value: 'USD' }, TxnTaxDetail: { TotalTax: 3.25 } }], nextStart: null }) };
    expect((await calculateQuickBooksTotal(client as any, { entity: 'Invoice', field: 'TxnTaxDetail.TotalTax' })).totals[0].value).toBe('3.25');
  });
  it.each([undefined, 'pending', Infinity])('refuses missing or invalid monetary input %s', async value => {
    const client = { company: vi.fn(), list: vi.fn().mockResolvedValue({ items: [row('1', value)], nextStart: null }) };
    await expect(calculateQuickBooksTotal(client as any, { entity: 'Invoice', field: 'Balance' })).rejects.toThrow(/invalid monetary/);
  });
  it('refuses unknown currency and failed pagination rather than publishing a partial total', async () => {
    const client = { company: vi.fn().mockResolvedValue({}), list: vi.fn().mockResolvedValue({ items: [{ Id: '1', Balance: 50 }], nextStart: null }) };
    await expect(calculateQuickBooksTotal(client as any, { entity: 'Invoice', field: 'Balance' })).rejects.toThrow(/currency/);
    client.list.mockResolvedValue({ items: [row('1', 50)], nextStart: 1 });
    await expect(calculateQuickBooksTotal(client as any, { entity: 'Invoice', field: 'Balance' })).rejects.toThrow(/pagination/);
    client.list.mockResolvedValueOnce({ items: [row('1', 50)], nextStart: 2 }).mockRejectedValueOnce(new Error('rate limit'));
    await expect(calculateQuickBooksTotal(client as any, { entity: 'Invoice', field: 'Balance' })).rejects.toThrow('rate limit');
  });
  it('honors currency precision and signed credits with decimal arithmetic', () => {
    expect(sumMoney(['0.10', '0.20', '-0.05'], 'USD')).toBe('0.25');
    expect(sumMoney(['100', '200'], 'JPY')).toBe('300');
    expect(sumMoney(['0.001', '0.002'], 'KWD')).toBe('0.003');
  });
});


it('uses company currency for HomeTotalAmt even on foreign-currency transactions', async () => {
  const client = { company: vi.fn().mockResolvedValue({ HomeCurrency: { value: 'USD' } }), list: vi.fn().mockResolvedValue({ items: [{ Id: '1', CurrencyRef: { value: 'EUR' }, HomeTotalAmt: 55 }], nextStart: null }) };
  expect((await calculateQuickBooksTotal(client as any, { entity: 'Invoice', field: 'HomeTotalAmt' })).totals).toEqual([{ currency: 'USD', value: '55.00', count: 1 }]);
});
