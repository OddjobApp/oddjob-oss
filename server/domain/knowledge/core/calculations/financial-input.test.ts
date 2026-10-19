import { describe, expect, it } from 'vitest';
import { numericNodeInput } from './financial-input';
import { calculationInputReferenceSchema } from '@shared/schema/knowledge/calculations';
describe('Explicit financial graph input', () => {
  it('selects the outstanding balance instead of the invoice amount', () => {
    expect(numericNodeInput({ data: { amount: 100, Balance: '40.00', currency: 'USD' } }, { field: 'Balance', currency: 'USD' })).toBe(40);
    expect(calculationInputReferenceSchema.parse({ nodeId: 1, variable: 'balance', field: 'Balance', currency: 'USD' })).toMatchObject({ field: 'Balance', currency: 'USD' });
  });
  it('handles nested monetary fields and refuses missing or wrong-unit inputs', () => {
    expect(numericNodeInput({ data: { TxnTaxDetail: { TotalTax: '2.50' }, currency: 'USD' } }, { field: 'TxnTaxDetail.TotalTax', currency: 'USD' })).toBe(2.5);
    expect(() => numericNodeInput({ data: { amount: 100 } }, { field: 'Balance', currency: 'USD' })).toThrow(/Missing/);
    expect(() => numericNodeInput({ data: { Balance: 50, currency: 'EUR' } }, { field: 'Balance', currency: 'USD' })).toThrow(/currency/);
    expect(() => numericNodeInput({ data: { amount: 'unknown' } })).toThrow();
    expect(() => numericNodeInput({ data: { amount: null } })).toThrow();
    expect(() => numericNodeInput({ data: {} }, { field: '__proto__.value' })).toThrow();
  });
});

it('selects home-currency totals with their own unit rather than the transaction currency', () => {
  expect(numericNodeInput({ data: { HomeTotalAmt: 55, homeCurrency: 'USD', currency: 'EUR' } }, { field: 'HomeTotalAmt', currency: 'USD' })).toBe(55);
  expect(() => numericNodeInput({ data: { HomeTotalAmt: 55, currency: 'EUR' } }, { field: 'HomeTotalAmt', currency: 'EUR' })).toThrow();
});
