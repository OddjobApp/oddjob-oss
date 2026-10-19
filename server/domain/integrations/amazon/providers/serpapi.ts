/**
 * SerpApi provider — second pluggable fallback, `engine=amazon` for search and
 * `engine=amazon_product` for detail/variations. GET serpapi.com/search.json
 * with the org's `api_key`, responses mapped onto AmazonProduct.
 */

import { buildProductUrl } from '../cart-link.js';
import type { AmazonProduct, AmazonProductProvider, AmazonSearchOptions, AmazonSearchResult } from '../types.js';
import type { KeyProviderConfig } from './rainforest.js';

function domainOf(marketplace: string): string {
    return marketplace.replace(/^www\./, '');
}

async function request(config: KeyProviderConfig, params: Record<string, string | number>): Promise<any> {
    const query = new URLSearchParams({ api_key: config.apiKey, amazon_domain: domainOf(config.marketplace) });
    for (const [key, value] of Object.entries(params)) query.set(key, String(value));
    const response = await fetch(`https://serpapi.com/search.json?${query}`);
    if (!response.ok) throw new Error(`SerpApi request failed (HTTP ${response.status}). Check the API key and plan quota.`);
    const data = await response.json();
    if (typeof data?.error === 'string' && data.error) {
        throw new Error(`SerpApi request failed: ${data.error.slice(0, 160)}.`);
    }
    return data;
}

function parsePrice(raw: unknown): number | undefined {
    if (typeof raw === 'number') return raw;
    if (typeof raw !== 'string') return undefined;
    const amount = Number(raw.replace(/[^0-9.]/g, ''));
    return Number.isFinite(amount) ? amount : undefined;
}

function priceOf(raw: any): AmazonProduct['price'] {
    const p = raw?.price ?? raw?.buybox_winner?.price;
    if (p == null) return undefined;
    if (typeof p === 'object') {
        const amount = typeof p.value === 'number' ? p.value : undefined;
        const display = typeof p.raw === 'string' ? p.raw : amount != null ? String(amount) : '';
        if (amount == null || !Number.isFinite(amount) || amount <= 0 || !p.currency) return undefined;
        return { amount, currency: String(p.currency), display };
    }
    return undefined;
}

function normalizeHit(hit: any, config: KeyProviderConfig): AmazonProduct {
    const asin = String(hit?.asin ?? '');
    return {
        asin,
        title: String(hit?.title ?? `Amazon item ${asin}`),
        brand: typeof hit?.brand === 'string' ? hit.brand : undefined,
        imageUrl: typeof hit?.thumbnail === 'string' ? hit.thumbnail : typeof hit?.image === 'string' ? hit.image : undefined,
        url: typeof hit?.link === 'string' ? hit.link : buildProductUrl(config.marketplace, asin),
        price: priceOf(hit),
        listPriceDisplay: typeof hit?.price?.old_price === 'string' ? String(hit.price.old_price) : undefined,
        rating: typeof hit?.rating === 'number' ? hit.rating : undefined,
        reviewCount: typeof hit?.reviews === 'number' ? hit.reviews
            : typeof hit?.reviews_total === 'number' ? hit.reviews_total : undefined,
        isPrime: hit?.is_prime === true || (typeof hit?.delivery === 'string' && /prime/i.test(hit.delivery)) || undefined,
        availability: typeof hit?.availability === 'string' ? hit.availability : typeof hit?.stock === 'string' ? hit.stock : undefined,
        merchant: typeof hit?.sold_by === 'string' ? hit.sold_by : undefined,
        parentAsin: typeof hit?.parent_asin === 'string' ? hit.parent_asin : undefined,
    };
}

export function createSerpApiProvider(config: KeyProviderConfig): AmazonProductProvider {
    return {
        id: 'serpapi',

        async searchItems(opts: AmazonSearchOptions): Promise<AmazonSearchResult> {
            const cfg = opts.marketplace ? { ...config, marketplace: opts.marketplace } : config;
            const data = await request(cfg, {
                engine: 'amazon',
                k: opts.keywords,
                ...(opts.searchIndex ? { amazon_search_index: opts.searchIndex } : {}),
                page: Math.min(Math.max(opts.itemPage ?? 1, 1), 10),
                ...(opts.primeOnly ? { prime: 'true' } : {}),
                ...(opts.minPrice != null ? { min_price: opts.minPrice } : {}),
                ...(opts.maxPrice != null ? { max_price: opts.maxPrice } : {}),
            });
            const results = (data?.organic_results ?? []) as any[];
            const items = results.map((hit: any) => normalizeHit(hit, cfg)).filter((p: AmazonProduct) => p.asin);
            const page = Math.min(Math.max(opts.itemPage ?? 1, 1), 10);
            const totalPages = typeof data?.serpapi_pagination?.total_pages === 'number'
                ? data.serpapi_pagination.total_pages
                : typeof data?.pagination?.total_pages === 'number' ? data.pagination.total_pages : undefined;
            const hasMore = items.length > 0 && (totalPages == null ? results.length > 0 : page < totalPages);
            return {
                items,
                totalResults: typeof data?.search_information?.total_results === 'number' ? data.search_information.total_results : undefined,
                nextPage: hasMore ? page + 1 : undefined,
                searchUrl: typeof data?.search_metadata?.amazon_url === 'string' ? data.search_metadata.amazon_url : undefined,
            };
        },

        async getItems(asins: string[], marketplace?: string): Promise<AmazonProduct[]> {
            const cfg = marketplace ? { ...config, marketplace } : config;
            const products = await Promise.all(asins.slice(0, 10).map(async (asin) => {
                const data = await request(cfg, { engine: 'amazon_product', asin });
                const hit = normalizeHit(data?.product_results ?? {}, cfg);
                if (!hit.asin) return null;
                if (typeof data?.product_results?.brand === 'string') hit.brand = data.product_results.brand;
                return hit;
            }));
            return products.filter((p): p is AmazonProduct => p !== null);
        },

        async getVariations(parentAsin: string, marketplace?: string): Promise<AmazonProduct[]> {
            const cfg = marketplace ? { ...config, marketplace } : config;
            const data = await request(cfg, { engine: 'amazon_product', asin: parentAsin });
            const variants = (data?.product_results?.variants ?? data?.variants ?? []) as any[];
            return variants.map((hit: any) => normalizeHit(hit, cfg)).filter((p: AmazonProduct) => p.asin && p.asin !== parentAsin);
        },
    };
}
