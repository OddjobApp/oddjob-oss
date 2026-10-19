import type { QuickBooksEntity } from '@domain/integrations/quickbooks/client.js';
export function financialCalculationRequest(message: string): { entity: QuickBooksEntity; field: 'Balance' | 'TotalAmt' | 'UnitPrice' | 'CurrentBalance'; outstanding?: boolean; overdue?: boolean } | null {
  if (/\b(create|send|pay|void|delete|update|edit|record)\b/i.test(message)) return null;
  if (!/\b(sum|total|aggregate)\b|\badd\b.*\bup\b/i.test(message)) return null;
  const entities: Array<[RegExp, QuickBooksEntity]> = [
    [/\binvoices?\b/i, 'Invoice'], [/\bbills?\b/i, 'Bill'], [/\bpayments?\b/i, 'Payment'],
    [/\bpurchases?\b|\bexpenses?\b/i, 'Purchase'], [/\bestimates?\b/i, 'Estimate'],
    [/\bcredit memos?\b/i, 'CreditMemo'], [/\bvendor credits?\b/i, 'VendorCredit'],
    [/\brefund receipts?\b/i, 'RefundReceipt'], [/\bsales receipts?\b/i, 'SalesReceipt'],
    [/\baccounts?\b/i, 'Account'], [/\bitems?\b.*\bprices?\b/i, 'Item'],
  ];
  const matched = entities.find(([pattern]) => pattern.test(message));
  if (!matched) return null;
  const entity = matched[1];
  const remainder = message.replace(matched[0], '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const allowed = new Set('please what is are the a an sum total amount all my our open outstanding unpaid overdue remaining due balance balances add up and give me of in quickbooks show calculate compute can you tell records original'.split(' '));
  if (remainder.some(word => !allowed.has(word))) return null;
  const overdue = /\boverdue\b/i.test(message);
  const outstanding = overdue || /\b(open|outstanding|unpaid|remaining|due|balance)\b/i.test(message);
  const field = entity === 'Account' ? 'CurrentBalance' : entity === 'Item' ? 'UnitPrice' : outstanding && ['Invoice', 'Bill'].includes(entity) ? 'Balance' : 'TotalAmt';
  // Do not route compound questions or filtered totals to an unfiltered whole-company sum.
  if (/\b(by|for|from|since|between|before|after|customer|month|year|today|selected)\b/i.test(message)) return null;
  return { entity, field, ...(outstanding && ['Invoice', 'Bill'].includes(entity) ? overdue ? { overdue: true } : { outstanding: true } : {}) };
}
