import { describe, expect, it } from 'vitest';
import { formatCrewMoney } from './crew-money';
describe('CREW monetary display', () => {
  it('includes a currency symbol and two decimals for zero, whole amounts and cents', () => {
    expect(formatCrewMoney(0)).toBe('$0.00');
    expect(formatCrewMoney(50)).toBe('$50.00');
    expect(formatCrewMoney('1234.56')).toBe('$1,234.56');
    expect(formatCrewMoney('(1,234.50)', 'GBP')).toBe('-£1,234.50');
    expect(formatCrewMoney(50, 'EUR')).toBe('€50.00');
  });
  it('preserves nonnumeric text and marks missing values without inventing amounts', () => {
    expect(formatCrewMoney('Pending')).toBe('Pending');
    expect(formatCrewMoney(null)).toBe('—');
    expect(formatCrewMoney(50, 'currency unverified')).toBe('50.00 currency unverified');
  });
});

it('keeps sub-cent precision for currencies with three minor-unit digits', () => {
  expect(formatCrewMoney('0.003', 'KWD')).toContain('0.003');
});
