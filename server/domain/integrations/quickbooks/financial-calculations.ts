import { sumMoney, decimalUnits, currencyScale } from '@shared/financial-money.js';
import type { QuickBooksClient, QuickBooksEntity } from './client.js';
export const FINANCIAL_FIELDS = ['TotalAmt', 'Balance', 'CurrentBalance', 'UnitPrice', 'PurchaseCost', 'UnappliedAmt', 'Amount', 'HomeTotalAmt', 'TxnTaxDetail.TotalTax'] as const;
export async function calculateQuickBooksTotal(client: Pick<QuickBooksClient, 'list' | 'company'>, options: {
  entity: QuickBooksEntity; field: typeof FINANCIAL_FIELDS[number]; outstanding?: boolean; overdue?: boolean;
}) {
  const totals = new Map<string, unknown[]>();
  const seen = new Set<string>();
  let start = 1;
  let homeCurrency: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await client.list(options.entity, { start, limit: 100, outstanding: options.outstanding, overdue: options.overdue });
    for (const record of result.items) {
      if (!record.Id || seen.has(String(record.Id))) throw new Error('QuickBooks returned missing or repeated record IDs; no complete total was calculated.');
      seen.add(String(record.Id));
      const currency = (options.field === 'HomeTotalAmt' ? undefined : record.CurrencyRef?.value) ?? (homeCurrency ??= (await client.company())?.HomeCurrency?.value);
      const scale = currencyScale(currency ?? '');
      // Validate every value: incomplete financial records must never count as zero.
      const value = options.field.split('.').reduce((value: any, part) => value?.[part], record);
      decimalUnits(value, scale);
      totals.set(currency, [...(totals.get(currency) ?? []), value]);
    }
    if (result.nextStart == null) return {
      entity: options.entity, field: options.field, matchedRecords: seen.size, complete: true,
      totals: [...totals].map(([currency, values]) => ({ currency, value: sumMoney(values, currency), count: values.length })),
    };
    if (result.nextStart <= start) throw new Error('QuickBooks pagination did not advance; no complete total was calculated.');
    start = result.nextStart;
  }
  throw new Error('QuickBooks calculation exceeded 10,000 records; no complete total was calculated. Narrow the scope.');
}
