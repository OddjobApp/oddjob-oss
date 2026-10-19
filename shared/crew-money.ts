/** Display monetary values without changing the numeric source data. */
export function formatCrewMoney(value: unknown, currency = 'USD'): string {
  if (value == null || value === '') return '—';
  const raw = String(value).trim();
  const normalized = raw.replace(/^[A-Z]{3}\s+|\s+[A-Z]{3}$/g, '').replace(/[$€£¥,]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return raw;
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return '—';
  try {
    const digits = Math.max(2, new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2);
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: digits }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || '(currency unverified)'}`;
  }
}
