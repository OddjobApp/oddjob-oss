import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
    select: vi.fn(), from: vi.fn(), where: vi.fn(),
    insert: vi.fn(), values: vi.fn(), returning: vi.fn(),
    resolveSecret: vi.fn(),
    credential: vi.fn(),
}));
vi.mock('@server/database_service.js', () => ({ db: { select: mocks.select, insert: mocks.insert } }));
vi.mock('@domain/auth/core/credential-secret-store.js', () => ({ resolveCredentialSecret: mocks.resolveSecret }));
vi.mock('@domain/auth/core/credentials-service.js', () => ({ credentialsService: { getForExecution: mocks.credential } }));
import { AMAZON_TOOLS, executeAmazonPurchaseApproval } from './amazon.js';
import { assertAsin, buildCartUrl, buildProductUrl } from '@domain/integrations/amazon/cart-link.js';
import { resetCreatorsTokenCache } from '@domain/integrations/amazon/providers/creators.js';
import { workspaceResultPayload } from '@domain/crew/core/crew-workspace-results.js';

const respond = (steps: { status?: number; body: any }[]) =>
    vi.fn().mockImplementation(() => {
        const next = steps.shift() ?? { body: {} };
        return Promise.resolve(new Response(JSON.stringify(next.body), { status: next.status ?? 200 }));
    });

const TOKEN = { body: { access_token: 'tok-1', expires_in: 3600 } };
const creatorsRow = {
    id: 1, type: 'api_key', organizationId: 342, envVarName: '',
    metadata: { provider: 'amazon_creators', clientId: 'amzn1.x', version: '3.1', partnerTag: 'mytag-20', marketplace: 'www.amazon.com' },
};
const catalogItem = {
    asin: 'B08XYZ1234', detailPageURL: 'https://www.amazon.com/dp/B08XYZ1234?tag=mytag-20',
    itemInfo: {
        title: { displayValue: 'Acme Widget' },
        byLineInfo: { brand: { displayValue: 'Acme' } },
        features: { displayValues: ['Feature one'] },
    },
    images: { primary: { large: { url: 'https://m.media-amazon.com/images/I/x.jpg' } } },
    offersV2: { listings: [{ price: { money: { amount: 99.99, currency: 'USD', displayAmount: '$99.99' }, savingBasis: { money: { displayAmount: '$129.99' } } }, availability: { message: 'In Stock' }, merchantInfo: { name: 'Acme Store' }, isPrime: true }] },
    customerReviews: { count: 120, starRating: { value: 4.5 } },
};
const itemResult = (items: any[]) => ({ body: { itemsResult: { items } } });

beforeEach(() => {
    vi.clearAllMocks();
    resetCreatorsTokenCache();
    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ where: mocks.where });
    mocks.where.mockResolvedValue([]);
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.values.mockReturnValue({ returning: mocks.returning });
    mocks.returning.mockResolvedValue([{ id: 42 }]);
    mocks.resolveSecret.mockResolvedValue('stored-secret');
    mocks.credential.mockResolvedValue({ id: 1, organizationId: 342 });
});
afterEach(() => vi.unstubAllGlobals());

describe('Amazon cart links', () => {
    it('builds a documented remote-cart URL with affiliate tag and validates inputs', () => {
        expect(buildCartUrl('www.amazon.com', 'mytag-20', [{ asin: 'b08xyz1234', quantity: 2 }]))
            .toBe('https://www.amazon.com/gp/aws/cart/add.html?AssociateTag=mytag-20&ASIN.1=B08XYZ1234&Quantity.1=2');
        expect(buildProductUrl('amazon.com', 'B08XYZ1234', 'mytag-20'))
            .toBe('https://www.amazon.com/dp/B08XYZ1234?tag=mytag-20');
        expect(() => buildCartUrl('evil.example', undefined, [{ asin: 'B08XYZ1234', quantity: 1 }])).toThrow('marketplace');
        expect(() => buildCartUrl('www.amazon.com', undefined, [{ asin: 'SHORT', quantity: 1 }])).toThrow('ASIN');
        expect(() => buildCartUrl('www.amazon.com', undefined, [{ asin: 'B08XYZ1234', quantity: 0 }])).toThrow('Quantity');
        expect(() => buildCartUrl('www.amazon.com', undefined, [])).toThrow('at least one');
        expect(() => buildCartUrl('www.amazon.com', undefined, Array.from({ length: 11 }, () => ({ asin: 'B08XYZ1234', quantity: 1 })))).toThrow('at most 10');
        expect(assertAsin('b08xyz1234')).toBe('B08XYZ1234');
    });
});

describe('Amazon product tools', () => {
    it('searches through the org Creators credential, tagging results, and renders product cards', async () => {
        mocks.where.mockResolvedValueOnce([creatorsRow]);
        const fetcher = respond([TOKEN, { body: { searchResult: { totalResultCount: 1, items: [catalogItem] } } }]);
        vi.stubGlobal('fetch', fetcher);
        const args = { query: 'widget' };
        const data = JSON.parse(await AMAZON_TOOLS.amazon_search_products.execute(args, { organizationId: 342, projectId: 3 }));

        expect(fetcher.mock.calls[0][0]).toBe('https://api.amazon.com/auth/o2/token');
        expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ grant_type: 'client_credentials', client_id: 'amzn1.x', client_secret: 'stored-secret', scope: 'creatorsapi::default' });
        expect(fetcher.mock.calls[1][0]).toBe('https://creatorsapi.amazon/catalog/v1/searchItems');
        expect(fetcher.mock.calls[1][1].headers['x-marketplace']).toBe('www.amazon.com');
        expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer tok-1');
        expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ keywords: 'widget', partnerTag: 'mytag-20', marketplace: 'www.amazon.com' });
        expect(data.items[0]).toMatchObject({ asin: 'B08XYZ1234', title: 'Acme Widget', brand: 'Acme', price: { amount: 99.99, currency: 'USD' }, rating: 4.5, reviewCount: 120, isPrime: true, availability: 'In Stock', merchant: 'Acme Store' });
        expect(data.source).toBe('creators');
        expect(mocks.credential).toHaveBeenCalledWith(1, 342);
        expect(JSON.stringify(data)).not.toContain('stored-secret');

        const card = workspaceResultPayload('amazon_search_products', data, args);
        expect(card?.title).toBe('Amazon');
        expect(card?.items[0]).toMatchObject({ id: 'B08XYZ1234', kind: 'product', platform: 'amazon', priceDisplay: '$99.99', listPriceDisplay: '$129.99', rating: 4.5, isPrime: true });
        expect(card?.items[0].cartUrl).toContain('https://www.amazon.com/gp/aws/cart/add.html?');
        expect(card?.items[0].cartUrl).toContain('ASIN.1=B08XYZ1234');
    });

    it('fails explicitly when the org has no Amazon credential', async () => {
        const fetcher = vi.fn();
        vi.stubGlobal('fetch', fetcher);
        await expect(AMAZON_TOOLS.amazon_search_products.execute({ query: 'x' }, { organizationId: 342 })).rejects.toThrow('not configured');
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('never uses a platform Associates tag, but falls back to a platform Rainforest key', async () => {
        mocks.where.mockResolvedValueOnce([]).mockResolvedValueOnce([
            { ...creatorsRow, id: 2, organizationId: null },
            { id: 3, type: 'api_key', organizationId: null, envVarName: '', metadata: { provider: 'amazon_rainforest', marketplace: 'www.amazon.com' } },
        ]);
        const fetcher = respond([{ body: { search_results: [{ asin: 'B08XYZ1234', title: 'Acme Widget', link: 'https://www.amazon.com/dp/B08XYZ1234', image: 'https://m.media-amazon.com/images/I/x.jpg', price: { raw: '$49.99', value: 49.99, currency: 'USD' }, rating: 4.2, ratings_total: 88, is_prime: true, availability: { raw: 'In Stock' } }] } }]);
        vi.stubGlobal('fetch', fetcher);
        const data = JSON.parse(await AMAZON_TOOLS.amazon_search_products.execute({ query: 'widget' }, { organizationId: 342 }));
        expect(data.source).toBe('rainforest');
        expect(String(fetcher.mock.calls[0][0])).toContain('api.rainforestapi.com/request');
        expect(data.items[0]).toMatchObject({ asin: 'B08XYZ1234', price: { amount: 49.99 }, rating: 4.2 });
    });

    it('rejects when only a platform Creators tag exists', async () => {
        mocks.where.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...creatorsRow, organizationId: null }]);
        const fetcher = vi.fn();
        vi.stubGlobal('fetch', fetcher);
        await expect(AMAZON_TOOLS.amazon_search_products.execute({ query: 'x' }, { organizationId: 342 })).rejects.toThrow('not configured');
        expect(fetcher).not.toHaveBeenCalled();
    });
    it('keeps a display-only Rainforest price unknown rather than treating it as zero', async () => {
        mocks.where.mockResolvedValue([{ id: 3, type: 'api_key', organizationId: 342, metadata: { provider: 'amazon_rainforest' } }]);
        vi.stubGlobal('fetch', respond([{ body: { product: { asin: 'B08XYZ1234', title: 'Widget', price: { raw: '$99.99', currency: 'USD' } } } }]));
        const result = JSON.parse(await AMAZON_TOOLS.amazon_get_product.execute({ asin: 'B08XYZ1234' }, { organizationId: 342 }));
        expect(result.item.price).toBeUndefined();
    });

    it('gets a product, lists variations and compares candidates', async () => {
        mocks.where.mockResolvedValue([creatorsRow]);
        const fetcher = respond([
            TOKEN, itemResult([catalogItem]),
            { body: { variationsResult: { items: [{ ...catalogItem, asin: 'B08CHILD01' }] } } },
            itemResult([catalogItem, { ...catalogItem, asin: 'B08XYZ9999', itemInfo: { title: { displayValue: 'Cheaper' } }, offersV2: { listings: [{ price: { money: { amount: 49.99, currency: 'USD', displayAmount: '$49.99' } } }] }, customerReviews: { count: 10, starRating: { value: 4.9 } } }]),
        ]);
        vi.stubGlobal('fetch', fetcher);

        const product = JSON.parse(await AMAZON_TOOLS.amazon_get_product.execute({ asin: 'B08XYZ1234' }, { organizationId: 342 }));
        expect(product.item.asin).toBe('B08XYZ1234');

        const variations = JSON.parse(await AMAZON_TOOLS.amazon_get_variations.execute({ parent_asin: 'B08PARENT1' }, { organizationId: 342 }));
        expect(variations.items[0].asin).toBe('B08CHILD01');

        const compared = JSON.parse(await AMAZON_TOOLS.amazon_compare_products.execute({ asins: ['B08XYZ1234', 'B08XYZ9999'] }, { organizationId: 342 }));
        expect(compared.winner).toEqual({ byPrice: 'B08XYZ9999', byRating: 'B08XYZ9999' });
    });

    it('reports an unknown ASIN as a failure rather than an empty success', async () => {
        mocks.where.mockResolvedValueOnce([creatorsRow]);
        vi.stubGlobal('fetch', respond([TOKEN, itemResult([])]));
        await expect(AMAZON_TOOLS.amazon_get_product.execute({ asin: 'B08XYZ1234' }, { organizationId: 342 })).rejects.toThrow('No Amazon product found');
    });

    it('builds a tagless cart link when no provider is configured', async () => {
        const fetcher = vi.fn();
        vi.stubGlobal('fetch', fetcher);
        const data = JSON.parse(await AMAZON_TOOLS.amazon_build_cart.execute({ items: [{ asin: 'b08xyz1234', quantity: 2 }] }, { organizationId: 342 }));
        expect(data.cartUrl).toBe('https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=B08XYZ1234&Quantity.1=2');
        expect(data.itemLinks[0].url).toBe('https://www.amazon.com/dp/B08XYZ1234');
        expect(fetcher).not.toHaveBeenCalled();
    });
});

describe('Amazon purchase proposals', () => {
    it('blocks budgeted proposals and approvals when pricing is unavailable', async () => {
        await expect(AMAZON_TOOLS.amazon_propose_purchase.execute({ items: [{ asin: 'B08XYZ1234', quantity: 1 }], max_total: 100 }, { organizationId: 342 })).rejects.toThrow('Cannot verify');
        expect(mocks.values).not.toHaveBeenCalled();
        await expect(executeAmazonPurchaseApproval('amazon_checkout', { items: [{ asin: 'B08XYZ1234', quantity: 1 }], max_total: 100 }, { organizationId: 342 })).rejects.toThrow('Cannot verify');
    });

    it('blocks missing, zero and mixed-currency prices instead of accepting a false total', async () => {
        mocks.where.mockResolvedValue([creatorsRow]);
        for (const amount of [0, -1]) {
            vi.stubGlobal('fetch', respond([TOKEN, itemResult([{ ...catalogItem, offersV2: { listings: [{ price: { money: { amount, currency: 'USD' } } }] } }])]));
            resetCreatorsTokenCache();
            await expect(executeAmazonPurchaseApproval('amazon_checkout', { items: [{ asin: 'B08XYZ1234', quantity: 1 }], max_total: 100 }, { organizationId: 342 })).rejects.toThrow('Cannot verify');
        }
        resetCreatorsTokenCache();
        vi.stubGlobal('fetch', respond([TOKEN, itemResult([catalogItem, { ...catalogItem, asin: 'B08XYZ9999', offersV2: { listings: [{ price: { money: { amount: 10, currency: 'EUR' } } }] } }])]));
        await expect(executeAmazonPurchaseApproval('amazon_checkout', { items: [{ asin: 'B08XYZ1234', quantity: 1 }, { asin: 'B08XYZ9999', quantity: 1 }], max_total: 300 }, { organizationId: 342 })).rejects.toThrow('Cannot verify');
    });

    it('preserves a requested marketplace in product and cart links', async () => {
        mocks.where.mockResolvedValue([creatorsRow]);
        vi.stubGlobal('fetch', respond([TOKEN, itemResult([catalogItem])]));
        const data = JSON.parse(await AMAZON_TOOLS.amazon_get_product.execute({ asin: 'B08XYZ1234', marketplace: 'www.amazon.co.uk' }, { organizationId: 342 }));
        expect(data.item.url).toContain('https://www.amazon.co.uk/');
        expect(data.item.cartUrl).toContain('https://www.amazon.co.uk/');
    });
    it('requires a fresh review when the approved currency changes', async () => {
        mocks.where.mockResolvedValue([creatorsRow]);
        vi.stubGlobal('fetch', respond([TOKEN, itemResult([catalogItem])]));
        await expect(executeAmazonPurchaseApproval('amazon_checkout', { items: [{ asin: 'B08XYZ1234', quantity: 1 }], max_total: 300, currency: 'EUR' }, { organizationId: 342 })).rejects.toThrow('currency changed');
    });

    it('files a priced approval request and orders nothing', async () => {
        mocks.where.mockResolvedValueOnce([creatorsRow]);
        vi.stubGlobal('fetch', respond([TOKEN, itemResult([catalogItem])]));
        const result = JSON.parse(await AMAZON_TOOLS.amazon_propose_purchase.execute(
            { items: [{ asin: 'B08XYZ1234', quantity: 2 }], reason: 'restock', max_total: 300 },
            { organizationId: 342, projectId: 3, userId: 'crew-user' }));
        expect(result).toMatchObject({ type: 'approval_request', kind: 'amazon_purchase', actionName: 'amazon_checkout', proposalId: 42, status: 'pending' });
        expect(result.args.items[0]).toMatchObject({ asin: 'B08XYZ1234', quantity: 2, title: 'Acme Widget' });
        expect(result.args.estimated_total).toBe('$199.98');
        expect(result.args.cart_url).toContain('AssociateTag=mytag-20');
        expect(result.message).toContain('nothing has been ordered');
        expect(mocks.values.mock.calls[0][0]).toMatchObject({ toolName: 'amazon_propose_purchase', organizationId: 342, status: 'pending' });
    });

    it('refuses to file a proposal already over its own budget', async () => {
        mocks.where.mockResolvedValueOnce([creatorsRow]);
        vi.stubGlobal('fetch', respond([TOKEN, itemResult([catalogItem])]));
        await expect(AMAZON_TOOLS.amazon_propose_purchase.execute(
            { items: [{ asin: 'B08XYZ1234', quantity: 5 }], reason: 'too many', max_total: 100 },
            { organizationId: 342 })).rejects.toThrow('exceeds max_total');
        expect(mocks.values).not.toHaveBeenCalled();
    });

    it('requires an organization context', async () => {
        await expect(AMAZON_TOOLS.amazon_propose_purchase.execute(
            { items: [{ asin: 'B08XYZ1234', quantity: 1 }], reason: 'x' }, {})).rejects.toThrow('Organization context');
    });

    it('re-prices on approval and issues a checkout handoff link only within budget', async () => {
        mocks.where.mockResolvedValue([creatorsRow]);
        vi.stubGlobal('fetch', respond([TOKEN, itemResult([catalogItem])]));
        const approved = await executeAmazonPurchaseApproval('amazon_checkout',
            { items: [{ asin: 'B08XYZ1234', quantity: 2 }], max_total: 300 },
            { organizationId: 342 });
        expect(approved.checkoutUrl).toBe('https://www.amazon.com/gp/aws/cart/add.html?AssociateTag=mytag-20&ASIN.1=B08XYZ1234&Quantity.1=2');
        expect(approved.items[0]).toMatchObject({ asin: 'B08XYZ1234', lineTotal: 199.98 });
        expect(approved.estimatedTotal).toBe('$199.98');
        expect(approved.handoff).toBe('approver_browser');

        vi.stubGlobal('fetch', respond([itemResult([catalogItem])]));
        await expect(executeAmazonPurchaseApproval('amazon_checkout',
            { items: [{ asin: 'B08XYZ1234', quantity: 5 }], max_total: 100 },
            { organizationId: 342 })).rejects.toThrow('exceeds the approved max_total');

        await expect(executeAmazonPurchaseApproval('other_action', {}, { organizationId: 342 })).rejects.toThrow('Unsupported Amazon action');
    });
});
