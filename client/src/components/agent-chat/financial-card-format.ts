/**
 * Display text for the financial cards (forecast, snapshot). The tools return
 * machine values — `three_statement`, `netIncome`, ISO timestamps — and a card
 * should never show those as they are.
 */

const FORECAST_METHODS: Record<string, string> = {
    growth: 'Growth',
    linear_trend: 'Linear trend',
    seasonal: 'Seasonal',
    cashflow: 'Cash flow',
    three_statement: 'Three-statement',
};

const SERIES_COLUMNS: Record<string, string> = {
    period: 'Period',
    inflow: 'Inflows',
    outflow: 'Outflows',
    revenue: 'Revenue',
    netIncome: 'Net income',
    assets: 'Assets',
    liabilitiesAndEquity: 'Liabilities & equity',
    operatingCashFlow: 'Operating cash flow',
    capex: 'Capital expenditure',
};

const PREDICTIONS: Record<string, string> = {
    shortfall: 'Shortfall expected',
    no_shortfall: 'No shortfall expected',
};

const SOURCE_TOOLS: Record<string, string> = {
    quickbooks_calculate_total: 'QuickBooks total',
    quickbooks_get_report: 'QuickBooks report',
    quickbooks_forecast_cashflow: 'QuickBooks cash-flow forecast',
    calculate_financial_forecast: 'Financial forecast',
};

/** `linear_trend` → "Linear trend", `netIncome` → "Net income". */
export function humanize(value: string): string {
    const words = value.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

export const forecastMethodLabel = (method: string) => FORECAST_METHODS[method] ?? humanize(method);
export const predictionLabel = (label: string) => PREDICTIONS[label] ?? humanize(label);
export const sourceToolLabel = (tool: string) => SOURCE_TOOLS[tool] ?? humanize(tool);

/** The `value` column means ending cash for cash models and the projection otherwise. */
export function seriesColumnLabel(key: string, method: string): string {
    if (key === 'value') return method === 'cashflow' || method === 'three_statement' ? 'Ending cash' : 'Projected value';
    return SERIES_COLUMNS[key] ?? humanize(key);
}

/** A numbered period as the person counts it: "Week 3". A period that is already a label stays as it is. */
export function periodLabel(period: string | number, unit: string): string {
    return typeof period === 'number' || /^\d+$/.test(String(period)) ? `${humanize(unit)} ${period}` : String(period);
}

/** "13 weeks", "1 month". */
export function periodCount(count: number, unit: string): string {
    const singular = unit.toLowerCase().replace(/s$/, '');
    return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

/** A date-only value reads as a date; a timestamp adds the time. Anything unparseable is shown as it came. */
export function formatWhen(value: string | null | undefined): string {
    if (!value) return '—';
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const parsed = new Date(dateOnly ? `${value}T12:00:00Z` : value);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat('en-US', dateOnly
        ? { dateStyle: 'medium', timeZone: 'UTC' }
        : { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

/** "12.5%", with a sign for changes; null reads as unavailable. */
export function formatPercent(value: string | number | null | undefined, signed = false): string {
    if (value == null || value === '') return 'Unavailable';
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    const text = `${Math.abs(n) < 10 ? n.toFixed(1) : n.toFixed(0)}%`;
    return signed && n > 0 ? `+${text}` : text;
}
