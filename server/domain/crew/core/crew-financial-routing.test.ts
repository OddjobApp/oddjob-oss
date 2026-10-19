import { describe, expect, it } from 'vitest';
import { financialCalculationRequest } from './crew-financial-routing';
describe('Accounting calculation routing', () => {
  it.each([['Sum all open invoices', 'Invoice', 'Balance'], ['Total outstanding bills', 'Bill', 'Balance'], ['Total QuickBooks purchases', 'Purchase', 'TotalAmt'], ['Sum all vendor credits', 'VendorCredit', 'TotalAmt'], ['Sum all account balances', 'Account', 'CurrentBalance']])('routes %s to explicit fields', (text, entity, field) => {
    expect(financialCalculationRequest(text)).toMatchObject({ entity, field });
  });
  it.each(['Total invoices for customer 1', 'Sum invoices this month', 'Pay all invoices', 'Total selected invoices', 'Total Acme bills', 'Sum invoices and bills'])('leaves filtered or write requests %s to the regular governed path', text => {
    expect(financialCalculationRequest(text)).toBeNull();
  });
});
