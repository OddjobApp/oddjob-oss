export const QUICKBOOKS_ENTITIES = ['Customer', 'Vendor', 'Account', 'Item', 'Invoice', 'Bill', 'Purchase', 'Payment', 'Estimate', 'CreditMemo', 'VendorCredit', 'SalesReceipt', 'RefundReceipt', 'BillPayment', 'Deposit', 'Transfer', 'JournalEntry', 'PurchaseOrder'] as const;
export type QuickBooksEntity = typeof QUICKBOOKS_ENTITIES[number];
export const QUICKBOOKS_REPORTS = ['ProfitAndLoss', 'BalanceSheet', 'CashFlow', 'AgedReceivables', 'AgedPayables'] as const;
export type QuickBooksReport = typeof QUICKBOOKS_REPORTS[number];

export function entityQuery(entity: QuickBooksEntity, options: { start?: number; limit?: number; search?: string; overdue?: boolean; outstanding?: boolean } = {}) {
    if (!QUICKBOOKS_ENTITIES.includes(entity)) throw new Error('Unsupported QuickBooks entity.');
    const start = options.start ?? 1, limit = options.limit ?? 25;
    if (!Number.isInteger(start) || start < 1 || start > 1_000_000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid QuickBooks pagination.');
    const where: string[] = [];
    if (options.search) {
        if (entity === 'Payment') throw new Error('Payment text search is unsupported; list payments or read a payment by ID.');
        if (options.search.length > 100) throw new Error('Search is too long.');
        const field = ['Customer', 'Vendor'].includes(entity) ? 'DisplayName' : ['Account', 'Item'].includes(entity) ? 'Name' : 'DocNumber';
        const escaped = options.search.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[%_]/g, '');
        where.push(`${field} LIKE '%${escaped}%'`);
    }
    if (options.outstanding && !options.overdue) {
        if (!['Invoice', 'Bill'].includes(entity)) throw new Error('Outstanding filtering applies to invoices and bills only.');
        where.push(`Balance > '0'`);
    }
    if (options.overdue) {
        if (!['Invoice', 'Bill'].includes(entity)) throw new Error('Overdue filtering applies to invoices and bills only.');
        where.push(`Balance > '0'`, `DueDate < '${new Date().toISOString().slice(0, 10)}'`);
    }
    return `SELECT * FROM ${entity}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} STARTPOSITION ${start} MAXRESULTS ${limit}`;
}

export class QuickBooksClient {
    private readonly base: string;
    constructor(readonly realmId: string, environment: 'sandbox' | 'production', private readonly getToken: () => Promise<string>) {
        if (!/^\d{1,30}$/.test(realmId)) throw new Error('Invalid QuickBooks company ID.');
        if (!['sandbox', 'production'].includes(environment)) throw new Error('Invalid QuickBooks environment.');
        this.base = `https://${environment === 'sandbox' ? 'sandbox-' : ''}quickbooks.api.intuit.com/v3/company/${realmId}/`;
    }
    private async request(path: string, query: Record<string, string> = {}, body?: unknown, requestId?: string) {
        const url = new URL(path, this.base);
        url.searchParams.set('minorversion', '75');
        for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
        if (requestId) url.searchParams.set('requestid', requestId);
        const response = await fetch(url, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(30_000),
            headers: { Authorization: `Bearer ${await this.getToken()}`, Accept: 'application/json', 'Content-Type': 'application/json' },
            ...(body ? { body: JSON.stringify(body) } : {}) });
        if (!response.ok) {
            if (response.status === 401) throw new Error('QuickBooks authorization expired. Reconnect QuickBooks.');
            if (response.status === 429) throw new Error('QuickBooks rate limit reached. Try again later.');
            throw new Error(`QuickBooks request failed (${response.status}); no successful accounting operation was confirmed.`);
        }
        const result = await response.json();
        if (result.Fault) throw new Error('QuickBooks rejected the accounting request. Review its fields and permissions.');
        return result;
    }
    async company() {
        const company = (await this.request(`companyinfo/${this.realmId}`)).CompanyInfo;
        const preferences = (await this.request('preferences')).Preferences;
        return { ...company, HomeCurrency: preferences?.CurrencyPrefs?.HomeCurrency ?? null };
    }
    async list(entity: QuickBooksEntity, options: Parameters<typeof entityQuery>[1]) {
        const data = await this.request('query', { query: entityQuery(entity, options) });
        const items = data.QueryResponse?.[entity] ?? [];
        return { entity, items, start: options?.start ?? 1, nextStart: items.length === (options?.limit ?? 25) ? (options?.start ?? 1) + items.length : null };
    }
    async get(entity: QuickBooksEntity, id: string) {
        if (!QUICKBOOKS_ENTITIES.includes(entity) || !/^\d{1,30}$/.test(id)) throw new Error('Invalid QuickBooks record reference.');
        return (await this.request(`${entity.toLowerCase()}/${id}`))[entity];
    }
    async report(report: QuickBooksReport, dates: { start_date?: string; end_date?: string }) {
        if (!QUICKBOOKS_REPORTS.includes(report)) throw new Error('Unsupported QuickBooks report.');
        return this.request(`reports/${report}`, Object.fromEntries(Object.entries(dates).filter(([, v]) => v != null)) as Record<string, string>);
    }
    async createInvoice(body: unknown, requestId: string) { return (await this.request('invoice', {}, body, requestId)).Invoice; }
    async createCustomer(body: unknown, requestId: string) { return (await this.request('customer', {}, body, requestId)).Customer; }
    async createPayment(body: unknown, requestId: string) { return (await this.request('payment', {}, body, requestId)).Payment; }
    async voidInvoice(invoiceId: string, syncToken: string, requestId: string) {
        if (!/^\d{1,30}$/.test(invoiceId)) throw new Error('Invalid QuickBooks invoice ID.');
        return (await this.request('invoice', { operation: 'void' }, { Id: invoiceId, SyncToken: syncToken }, requestId)).Invoice;
    }
    /**
     * Change Data Capture — entities changed since a timestamp. Lookback is
     * capped by Intuit at ~30 days and 1000 objects per entity; callers keep a
     * watermark and overlap `changedSince` slightly to cover in-flight writes.
     */
    async cdc(entities: readonly QuickBooksEntity[], changedSince: string) {
        const invalid = entities.filter(e => !QUICKBOOKS_ENTITIES.includes(e));
        if (entities.length === 0 || invalid.length > 0) throw new Error('Unsupported QuickBooks CDC entity list.');
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(changedSince)) throw new Error('Invalid QuickBooks CDC timestamp.');
        const data = await this.request('cdc', { entities: entities.join(','), changedSince });
        const changed: Record<string, any[]> = {};
        for (const response of data.CDCResponse ?? []) {
            for (const [entity, records] of Object.entries(response.QueryResponse ?? {})) {
                if (Array.isArray(records)) changed[entity] = [...(changed[entity] ?? []), ...records];
            }
        }
        return changed;
    }
}
