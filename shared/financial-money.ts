/** Strict decimal money arithmetic. Values remain numeric data, never formatted strings. */
export function decimalUnits(value: unknown, scale: number): bigint {
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) >= Number.MAX_SAFE_INTEGER) throw new Error('Monetary number exceeds safe numeric precision; use a decimal string.');
  const raw = typeof value === 'number' && Number.isFinite(value) ? value.toFixed(Math.min(12, scale + 6)) : String(value ?? '').trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) throw new Error(`Missing or invalid monetary value: ${raw}`);
  const fraction = match[3] ?? '';
  let units = BigInt(match[2]) * 10n ** BigInt(scale) + BigInt((fraction.slice(0, scale).padEnd(scale, '0')) || '0');
  if (Number(fraction[scale] ?? '0') >= 5) units += 1n;
  return match[1] === '-' ? -units : units;
}
export function currencyScale(currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('A verified ISO currency is required for financial calculations.');
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}
export function unitsDecimal(units: bigint, scale: number): string {
  const sign = units < 0n ? '-' : '';
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  return scale ? `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}` : `${sign}${digits}`;
}
export function sumMoney(values: unknown[], currency: string): string {
  const scale = currencyScale(currency);
  return unitsDecimal(values.reduce<bigint>((sum, value) => sum + decimalUnits(value, scale), 0n), scale);
}

/** Graph/dataset APIs return numbers; reject sums that their numeric contract cannot represent safely. */
export function sumMoneyNumber(values: unknown[], currency: string): number {
  const value = sumMoney(values, currency);
  const units = decimalUnits(value, currencyScale(currency));
  if (units > BigInt(Number.MAX_SAFE_INTEGER) || units < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Financial result exceeds safe numeric precision.');
  return Number(value);
}
