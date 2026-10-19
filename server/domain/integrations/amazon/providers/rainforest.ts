/**
 * Rainforest API provider — pluggable fallback for orgs without an accepted
 * Amazon Associates account. GET api.rainforestapi.com/request with an
 * `api_key` and `amazon_domain`, responses mapped onto AmazonProduct.
 */

import { buildProductUrl } from '../cart-link.js';
import type { AmazonProduct, AmazonProductProvider, AmazonSearchOptions, AmazonSearchResult } from '../types.js';

export interface KeyProviderConfig {
    apiKey: string;
    /** Marketplace host like "www.amazon.com"; the API wants "amazon.com". */
    marketplace: string;
}

function domainOf(marketplace: string): string {
    return marketplace.replace(/^www\./, '');
}

async function request(config: KeyProviderConfig, params: Record<string, string | number>): Promise<any> {
    const query = new URLSearchParams({ api_key: config.apiKey, amazon_domain: domainOf(config.marketplace) });
    for (const [key, value] of Object.entries(params)) query.set(key, String(value));
    const response = await fetch(`https://api.rainforestapi.com/request?${query}`);
    if (!response.ok) throw new Error(`Rainforest API request failed (HTTP ${response.status}). Check the API key and plan quota.`);
    const data = await response.json();
    if (data?.request_info?.success === false) {
        throw new Error(`Rainforest API request failed${data.request_info.message ? `: ${String(data.request_info.message).slice(0, 160)}` : ''}.`);
    }
    return data;
}

function priceOf(raw: any): AmazonProduct['price'] {
    const p = raw?.price ?? raw?.buybox_winner?.price;
    if (!p) return undefined;
    const amount = typeof p.value === 'number' ? p.value : undefined;
    const display = typeof p.raw === 'string' ? p.raw : amount != null ? String(amount) : '';
    if (amount == null || !Number.isFinite(amount) || amount <= 0 || !p.currency) return undefined;
    return { amount, currency: String(p.currency), display };
}

function normalizeHit(hit: any, config: KeyProviderConfig): AmazonProduct {
    const asin = String(hit?.asin ?? '');
    return {
        asin,
        title: String(hit?.title ?? `Amazon item ${asin}`),
        brand: typeof hit?.brand === 'string' ? hit.brand : undefined,
        imageUrl: typeof hit?.image === 'string' ? hit.image : typeof hit?.thumbnail === 'string' ? hit.thumbnail : undefined,
        url: typeof hit?.link === 'string' ? hit.link : buildProductUrl(config.marketplace, asin),
        price: priceOf(hit),
        listPriceDisplay: typeof hit?.price?.before_price?.raw === 'string' ? hit.price.before_price.raw
            : typeof hit?.list_price?.raw === 'string' ? hit.list_price.raw : undefined,
        rating: typeof hit?.rating === 'number' ? hit.rating : undefined,
        reviewCount: typeof hit?.ratings_total === 'number' ? hit.ratings_total
            : typeof hit?.reviews_total === 'number' ? hit.reviews_total : undefined,
        isPrime: hit?.is_prime === true || hit?.delivery?.is_prime === true || undefined,
        availability: typeof hit?.availability?.raw === 'string' ? hit.availability.raw : undefined,
        merchant: typeof hit?.sold_by === 'string' ? hit.sold_by : undefined,
        parentAsin: typeof hit?.parent_asin === 'string' ? hit.parent_asin : undefined,
        features: Array.isArray(hit?.feature_bullets) ? hit.feature_bullets.map(String).slice(0, 8) : undefined,
    };
}

function normalizeProduct(data: any, config: KeyProviderConfig): AmazonProduct | null {
    const product = data?.product;
    if (!product) return null;
    const hit = normalizeHit(product, config);
    if (!hit.asin) return null;
    hit.features = Array.isArray(product.feature_bullets) ? product.feature_bullets.map(String).slice(0, 8) : hit.features;
    hit.brand = hit.brand ?? (typeof product.brand === 'string' ? product.brand : undefined);
    return hit;
}

export function createRainforestProvider(config: KeyProviderConfig): AmazonProductProvider {
    return {
        id: 'rainforest',

        async searchItems(opts: AmazonSearchOptions): Promise<AmazonSearchResult> {
            const cfg = opts.marketplace ? { ...config, marketplace: opts.marketplace } : config;
            const data = await request(cfg, {
                type: 'search',
                search_term: opts.keywords,
                ...(opts.searchIndex ? { category_id: opts.searchIndex } : {}),
                page: Math.min(Math.max(opts.itemPage ?? 1, 1), 10),
                ...(opts.primeOnly ? { 'filters[prime]': 'true' } : {}),
                ...(opts.minPrice != null ? { min_price: opts.minPrice } : {}),
                ...(opts.maxPrice != null ? { max_price: opts.maxPrice } : {}),
            });
            const results = (data?.search_results ?? []) as any[];
            const items = results.map((hit: any) => normalizeHit(hit, cfg)).filter((p: AmazonProduct) => p.asin);
            const totalResults = typeof data?.pagination?.total_results === 'number' ? data.pagination.total_results : undefined;
            const page = Math.min(Math.max(opts.itemPage ?? 1, 1), 10);
            const hasMore = items.length > 0 && (totalResults == null || results.length >= (opts.itemCount ?? 16));
            return {
                items,
                totalResults,
                nextPage: hasMore ? page + 1 : undefined,
                searchUrl: typeof data?.search_metadata?.amazon_url === 'string' ? data.search_metadata.amazon_url : undefined,
            };
        },

        async getItems(asins: string[], marketplace?: string): Promise<AmazonProduct[]> {
            const cfg = marketplace ? { ...config, marketplace } : config;
            const products = await Promise.all(asins.slice(0, 10).map(async (asin) => {
                const data = await request(cfg, { type: 'product', asin });
                return normalizeProduct(data, cfg);
            }));
            return products.filter((p): p is AmazonProduct => p !== null);
        },

        async getVariations(parentAsin: string, marketplace?: string): Promise<AmazonProduct[]> {
            const cfg = marketplace ? { ...config, marketplace } : config;
            const data = await request(cfg, { type: 'product', asin: parentAsin });
            const variants = (data?.product?.variants ?? data?.variants ?? []) as any[];
            return variants.map((hit: any) => normalizeHit(hit, cfg)).filter((p: AmazonProduct) => p.asin && p.asin !== parentAsin);
        },
    };
}
