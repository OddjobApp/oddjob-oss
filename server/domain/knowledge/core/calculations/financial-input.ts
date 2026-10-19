export interface NumericInputSelection { field?: string; currency?: string; }
/** Explicit financial field paths select data only; missing inputs are errors, not zero. */
export function numericNodeInput(node: { data?: unknown }, selection: NumericInputSelection = {}): number {
  const data = node.data as Record<string, unknown> | null;
  if ((data?.currency || data?.CurrencyRef) && !selection.field) throw new Error('Financial inputs require an explicit field.');
  let value: unknown;
  if (selection.field) {
    const path = selection.field.split('.');
    if (path.some(part => !/^[A-Za-z0-9_]+$/.test(part) || ['__proto__', 'prototype', 'constructor'].includes(part))) throw new Error('Invalid calculation input field.');
    value = path.reduce<unknown>((current, part) => current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, part) ? (current as Record<string, unknown>)[part] : undefined, data);
  } else value = data?.value ?? data?.amount ?? data?.count ?? data?.metric ?? data?.quantity ?? data?.total;
  if (selection.field && /^(amount|balance|totalamt|currentbalance|unitprice|purchasecost|unappliedamt|hometotalamt|totaltax|signedamount|amount_paid|tax|subtotal|discount)$/i.test(selection.field.split('.').pop() ?? '') && !selection.currency) throw new Error('Financial inputs require an expected currency.');
  const actualCurrency = selection.field === 'HomeTotalAmt' ? data?.homeCurrency : data?.currency ?? (data?.CurrencyRef as any)?.value;
  if (selection.currency && actualCurrency !== selection.currency) throw new Error('Missing or mismatched currency on calculation input.');
  if (value == null || value === '' || !['number', 'string'].includes(typeof value) || (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))) throw new Error(`Missing or invalid numeric input${selection.field ? `: ${selection.field}` : ''}.`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('Calculation input must be finite.');
  return number;
}
