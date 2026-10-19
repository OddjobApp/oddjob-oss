import { describe, expect, it } from 'vitest';
import { formatPercent, formatWhen, humanize, periodCount, periodLabel, seriesColumnLabel } from './financial-card-format';

describe('financial card formatting', () => {
    it('humanizes machine keys', () => {
        expect(humanize('linear_trend')).toBe('Linear trend');
        expect(humanize('operatingCashFlow')).toBe('Operating cash flow');
    });
    it('names the value column by what the model projects', () => {
        expect(seriesColumnLabel('value', 'cashflow')).toBe('Ending cash');
        expect(seriesColumnLabel('value', 'growth')).toBe('Projected value');
        expect(seriesColumnLabel('capex', 'three_statement')).toBe('Capital expenditure');
    });
    it('counts and labels periods', () => {
        expect(periodLabel(3, 'week')).toBe('Week 3');
        expect(periodLabel('2026-10-12', 'week')).toBe('2026-10-12');
        expect(periodCount(13, 'week')).toBe('13 weeks');
        expect(periodCount(1, 'months')).toBe('1 month');
    });
    it('reads dates without shifting a date-only value across time zones', () => {
        expect(formatWhen('2026-10-08')).toBe('Oct 8, 2026');
        expect(formatWhen('not a date')).toBe('not a date');
        expect(formatWhen(null)).toBe('—');
    });
    it('formats percentages and keeps a missing one honest', () => {
        expect(formatPercent('12.345', true)).toBe('+12%');
        expect(formatPercent(-3.21)).toBe('-3.2%');
        expect(formatPercent(null)).toBe('Unavailable');
    });
});
