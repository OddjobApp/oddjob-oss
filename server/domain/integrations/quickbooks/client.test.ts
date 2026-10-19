import { afterEach, describe, expect, it, vi } from 'vitest';
import { entityQuery, QuickBooksClient } from './client.js';
afterEach(() => vi.unstubAllGlobals());
describe('QuickBooks accounting client', () => {
    it('fetches outstanding invoices without restricting them to overdue dates', () => {
        expect(entityQuery('Invoice', { outstanding: true })).toContain("WHERE Balance > '0'");
        expect(entityQuery('Invoice', { outstanding: true })).not.toContain('DueDate');
        expect(() => entityQuery('Customer', { outstanding: true })).toThrow();
    });
    it('rejects injected entities and invalid record references', async () => {
        expect(() => entityQuery('Invoice DELETE' as any)).toThrow();
        expect(() => new QuickBooksClient('../other', 'sandbox', async () => 'token')).toThrow();
        await expect(new QuickBooksClient('123', 'sandbox', async () => 'token').get('Invoice', '../customer')).rejects.toThrow();
    });
    it('escapes search literals and enforces pagination', () => {
        expect(entityQuery('Customer', { search: "O'Brien" })).toContain("O\\'Brien");
        expect(() => entityQuery('Invoice', { limit: 1001 })).toThrow();
        expect(() => entityQuery('Customer', { overdue: true })).toThrow();
    });
    it('uses the sandbox company endpoint and returns a pagination cursor', async () => {
        const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ QueryResponse: { Invoice: [{ Id: '1' }] } }) });
        vi.stubGlobal('fetch', fetcher);
        const result = await new QuickBooksClient('123', 'sandbox', async () => 'private-token').list('Invoice', { start: 1, limit: 1 });
        expect(result.nextStart).toBe(2);
        const [url, options] = fetcher.mock.calls[0];
        expect(url.origin).toBe('https://sandbox-quickbooks.api.intuit.com');
        expect(url.pathname).toBe('/v3/company/123/query');
        expect(options.headers.Authorization).toBe('Bearer private-token');
    });
    it('sends a stable request ID for approved invoice retry protection', async () => {
        const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ Invoice: { Id: '55' } }) });
        vi.stubGlobal('fetch', fetcher);
        expect(await new QuickBooksClient('123', 'production', async () => 'token').createInvoice({ CustomerRef: { value: '1' } }, 'oddjob-approval-42')).toEqual({ Id: '55' });
        expect(fetcher.mock.calls[0][0].searchParams.get('requestid')).toBe('oddjob-approval-42');
        expect(fetcher.mock.calls[0][1].method).toBe('POST');
    });
    it('reports rate limits without exposing response bodies or tokens', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
        await expect(new QuickBooksClient('123', 'sandbox', async () => 'secret').company()).rejects.toThrow(/rate limit/);
    });
    it('queries change-data-capture with a bounded entity list', async () => {
        const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ CDCResponse: [{ QueryResponse: { Invoice: [{ Id: '1' }], Customer: [{ Id: '2' }] } }] }) });
        vi.stubGlobal('fetch', fetcher);
        const changed = await new QuickBooksClient('123', 'sandbox', async () => 'token').cdc(['Invoice', 'Customer'], '2026-10-01T00:00:00Z');
        expect(changed).toEqual({ Invoice: [{ Id: '1' }], Customer: [{ Id: '2' }] });
        const [url] = fetcher.mock.calls[0];
        expect(url.pathname).toBe('/v3/company/123/cdc');
        expect(url.searchParams.get('entities')).toBe('Invoice,Customer');
        expect(url.searchParams.get('changedSince')).toBe('2026-10-01T00:00:00Z');
        await expect(new QuickBooksClient('123', 'sandbox', async () => 'token').cdc([], '2026-10-01T00:00:00Z')).rejects.toThrow();
        await expect(new QuickBooksClient('123', 'sandbox', async () => 'token').cdc(['Invoice'], 'yesterday')).rejects.toThrow();
    });
    it('voids invoices through the operation endpoint and guards payment writes', async () => {
        const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ Invoice: { Id: '9', Balance: 0 } }) });
        vi.stubGlobal('fetch', fetcher);
        const client = new QuickBooksClient('123', 'sandbox', async () => 'token');
        await client.voidInvoice('9', '2', 'oddjob-approval-7');
        const [url, options] = fetcher.mock.calls[0];
        expect(url.pathname).toBe('/v3/company/123/invoice');
        expect(url.searchParams.get('operation')).toBe('void');
        expect(JSON.parse(options.body)).toEqual({ Id: '9', SyncToken: '2' });
        await expect(client.voidInvoice('../x', '2', 'r')).rejects.toThrow();
    });
});


it('resolves home currency from Preferences rather than inferring it from company country', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ CompanyInfo: { Id: '123', Country: 'CA' } }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ Preferences: { CurrencyPrefs: { HomeCurrency: { value: 'CAD' } } } }) });
  vi.stubGlobal('fetch', fetcher);
  const company = await new QuickBooksClient('123', 'sandbox', async () => 'token').company();
  expect(company.HomeCurrency.value).toBe('CAD');
  expect(fetcher.mock.calls[1][0].pathname).toBe('/v3/company/123/preferences');
});
