// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Gateways call addresses users type (a SaaS base URL, a webhook). Those go
 * through the egress firewall; only our own private services skip it.
 */
const mocks = vi.hoisted(() => ({ nodeFetch: vi.fn(), log: vi.fn() }));
vi.mock('node-fetch', () => ({ default: mocks.nodeFetch }));
// Inside the production network `qdrant` resolves to a private Docker address.
vi.mock('node:dns/promises', () => ({
    lookup: async (host: string) => {
        if (host === 'qdrant') return [{ address: '172.18.0.5', family: 4 }];
        throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
    },
}));
vi.mock('../api-log.service.js', () => ({ apiLogService: { log: async (entry: unknown) => { mocks.log(entry); } } }));
import { BaseGateway } from './base.gateway.js';

class TestGateway extends BaseGateway {
    protected readonly platform = 'test';
    call(req: Parameters<BaseGateway['request']>[0]) { return this.request(req); }
}
class InternalGateway extends TestGateway {
    protected readonly internalService = true;
}
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });

describe('BaseGateway egress', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // A fresh Response per call: a body can be read once.
        mocks.nodeFetch.mockImplementation(async () => ok());
        vi.stubGlobal('fetch', vi.fn(async () => ok()));
    });
    afterEach(() => vi.unstubAllGlobals());

    it.each([
        'http://qdrant:6333/collections?/rest/api/3/myself',
        'http://127.0.0.1:6379/',
        'http://169.254.169.254/latest/meta-data/',
        'http://10.0.0.5/admin',
    ])('refuses %s without making the request', async (url) => {
        const gateway = new TestGateway();
        await expect(gateway.call({ action: 'test_connection', method: 'GET', url })).rejects.toThrow(/Outbound request refused/);
        expect(mocks.nodeFetch).not.toHaveBeenCalled();
        // A name that resolves privately is refused at the DNS check, before any socket opens.
        expect((globalThis.fetch as any).mock.calls.filter((c: any[]) => String(c[0]).startsWith(url.split('?')[0])).length).toBe(0);
    });

    it('lets our own private service through when the request or gateway says so', async () => {
        await new TestGateway().call({ action: 'store_memory', method: 'POST', url: 'http://localhost:8002/api/v1/memory', internal: true });
        await new InternalGateway().call({ action: 'rank', method: 'POST', url: 'http://sidecar:8002/api/v1/graph/rank' });
        expect(mocks.nodeFetch).toHaveBeenCalledTimes(2);
    });

    it('keeps credentials sent in headers out of the API log', async () => {
        await new TestGateway().call({ action: 'store_memory', method: 'GET', url: 'http://localhost:8002/x', internal: true,
            headers: { Authorization: 'Basic c2VjcmV0', 'X-Api-Key': 'k', Accept: 'application/json' } });
        await vi.waitFor(() => expect(mocks.log).toHaveBeenCalled());
        const logged = mocks.log.mock.calls[0][0].requestHeaders;
        expect(logged).toEqual({ Authorization: '[redacted]', 'X-Api-Key': '[redacted]', Accept: 'application/json' });
        expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('c2VjcmV0');
    });
});
