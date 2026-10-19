/**
 * Amazon Creators API provider — the official, ToS-compliant product-data
 * channel (PA-API 5 successor). OAuth2 client_credentials against the regional
 * Login with Amazon endpoint chosen by credential version, then Bearer calls to
 * `https://creatorsapi.amazon/catalog/v1/*` with an `x-marketplace` header.
 *
 * Requires an accepted Amazon Associates account. Quotas scale with referred
 * revenue, so 429s are retried once with a short backoff.
 */

import { normalizeMarketplace } from '../cart-link.js';
import type { AmazonProduct, AmazonProductProvider, AmazonSearchOptions, AmazonSearchResult } from '../types.js';

export interface CreatorsConfig {
    clientId: string;
    clientSecret: string;
    /** Credential version selects the token region: 3.1 NA, 3.2 EU, 3.3 FE. */
    version?: '3.1' | '3.2' | '3.3';
    partnerTag: string;
    marketplace: string;
}

const TOKEN_HOSTS: Record<string, string> = {
    '3.1': 'api.amazon.com',
    '3.2': 'api.amazon.co.uk',
    '3.3': 'api.amazon.co.jp',
};
const API_BASE = 'https://creatorsapi.amazon';
const TOKEN_REFRESH_MS = 50 * 60 * 1000; // tokens live 1h; refresh early

const RESOURCES = [
    'images.primary.small', 'images.primary.medium', 'images.primary.large',
    'itemInfo.title', 'itemInfo.byLineInfo', 'itemInfo.features', 'itemInfo.productInfo',
    'offersV2.listings.price', 'offersV2.listings.availability', 'offersV2.listings.merchantInfo',
    'offersV2.listings.isBuyBoxWinner', 'offersV2.listings.type', 'offersV2.listings.condition',
    'customerReviews.count', 'customerReviews.starRating',
    'parentASIN',
];

let cachedToken: { key: string; value: string; expiresAt: number } | null = null;

/** Test hook — the module-level token cache is keyed by credential, not by test. */
export function resetCreatorsTokenCache() {
    cachedToken = null;
}

async function accessToken(config: CreatorsConfig): Promise<string> {
    const key = `${config.clientId}:${config.version ?? '3.1'}`;
    if (cachedToken?.key === key && cachedToken.expiresAt > Date.now()) return cachedToken.value;
    const host = TOKEN_HOSTS[config.version ?? '3.1'] ?? TOKEN_HOSTS['3.1'];
    const response = await fetch(`https://${host}/auth/o2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            grant_type: 'client_credentials',
            client_id: config.clientId,
            client_secret: config.clientSecret,
            scope: 'creatorsapi::default',
        }),
    });
    if (!response.ok) throw new Error(`Amazon Creators API token request failed (HTTP ${response.status}). Check the credential's client ID, secret and version.`);
    const data = await response.json();
    if (!data?.access_token) throw new Error('Amazon Creators API returned no access token.');
    cachedToken = { key, value: data.access_token, expiresAt: Date.now() + TOKEN_REFRESH_MS };
    return data.access_token;
}

async function call(config: CreatorsConfig, operation: string, body: Record<string, unknown>, retried = false): Promise<any> {
    const token = await accessToken(config);
    const marketplace = normalizeMarketplace((body.marketplace as string | undefined) ?? config.marketplace);
    const response = await fetch(`${API_BASE}/catalog/v1/${operation}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'x-marketplace': marketplace,
        },
        body: JSON.stringify({ ...body, marketplace, partnerTag: config.partnerTag }),
    });
    if (response.status === 429 && !retried) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        return call(config, operation, body, true);
    }
    if (response.status === 401 && !retried) {
        cachedToken = null; // token rejected despite the cache — refresh once
        return call(config, operation, body, true);
    }
    if (!response.ok) {
        let reason = '';
        try { reason = (await response.json()).errors?.[0]?.message ?? (await Promise.resolve('')); } catch { /* no provider body shown */ }
        throw new Error(`Amazon Creators API ${operation} failed (HTTP ${response.status}${reason ? `, ${reason.slice(0, 160)}` : ''}). Check the marketplace, partner tag and quota.`);
    }
    return response.json();
}

function displayOf(node: any): string {
    return typeof node?.displayValue === 'string' ? node.displayValue : typeof node === 'string' ? node : '';
}

function normalizeItem(item: any, config: CreatorsConfig): AmazonProduct {
    const listing = item?.offersV2?.listings?.find((l: any) => l?.isBuyBoxWinner) ?? item?.offersV2?.listings?.[0];
    const money = listing?.price?.money;
    const availability = listing?.availability;
    const delivery = listing?.deliveryInfo;
    const reviews = item?.customerReviews;
    const detailPage = typeof item?.detailPageURL === 'string' && item.detailPageURL
        ? item.detailPageURL
        : `https://${config.marketplace}/dp/${encodeURIComponent(String(item?.asin ?? ''))}`;
    return {
        asin: String(item?.asin ?? ''),
        title: displayOf(item?.itemInfo?.title) || `Amazon item ${item?.asin ?? ''}`,
        brand: displayOf(item?.itemInfo?.byLineInfo?.brand) || displayOf(item?.itemInfo?.byLineInfo?.manufacturer) || undefined,
        imageUrl: item?.images?.primary?.large?.url ?? item?.images?.primary?.medium?.url ?? item?.images?.primary?.small?.url,
        url: detailPage,
        price: money && typeof money.amount === 'number'
            ? { amount: money.amount, currency: String(money.currency ?? ''), display: String(money.displayAmount ?? money.amount) }
            : undefined,
        listPriceDisplay: listing?.price?.savingBasis?.money?.displayAmount,
        rating: typeof reviews?.starRating?.value === 'number' ? reviews.starRating.value : undefined,
        reviewCount: typeof reviews?.count === 'number' ? reviews.count : undefined,
        isPrime: listing?.isPrime === true || delivery?.isPrimeEligible === true || undefined,
        availability: typeof availability?.message === 'string' ? availability.message
            : typeof availability?.type === 'string' ? availability.type.replace(/_/g, ' ').toLowerCase() : undefined,
        merchant: displayOf(listing?.merchantInfo) || listing?.merchantInfo?.name || undefined,
        features: Array.isArray(item?.itemInfo?.features?.displayValues) ? item.itemInfo.features.displayValues.map(String).slice(0, 8) : undefined,
        parentAsin: typeof item?.parentASIN === 'string' ? item.parentASIN : undefined,
    };
}

function minorUnits(major: number): number {
    return Math.round(major * 100); // minPrice/maxPrice are in lowest denomination
}

export function createCreatorsProvider(config: CreatorsConfig): AmazonProductProvider {
    const marketplace = normalizeMarketplace(config.marketplace);
    const cfg = { ...config, marketplace };
    return {
        id: 'creators',

        async searchItems(opts: AmazonSearchOptions): Promise<AmazonSearchResult> {
            const body: Record<string, unknown> = {
                keywords: opts.keywords,
                searchIndex: opts.searchIndex || 'All',
                itemCount: Math.min(Math.max(opts.itemCount ?? 10, 1), 10),
                itemPage: Math.min(Math.max(opts.itemPage ?? 1, 1), 10),
                marketplace: opts.marketplace ?? marketplace,
                resources: RESOURCES,
            };
            if (opts.brand) body.brand = opts.brand;
            if (opts.sortBy) body.sortBy = opts.sortBy;
            if (opts.minPrice != null) body.minPrice = minorUnits(opts.minPrice);
            if (opts.maxPrice != null) body.maxPrice = minorUnits(opts.maxPrice);
            if (opts.primeOnly) body.deliveryFlags = ['Prime'];
            const data = await call(cfg, 'searchItems', body);
            const result = data?.searchResult ?? {};
            const items = (result.items ?? []).map((item: any) => normalizeItem(item, cfg)).filter((p: AmazonProduct) => p.asin);
            const totalResults = typeof result.totalResultCount === 'number' ? result.totalResultCount : undefined;
            const page = body.itemPage as number;
            const hasMore = page < 10 && items.length === (body.itemCount as number) && (totalResults == null || page * (body.itemCount as number) < totalResults);
            return { items, totalResults, nextPage: hasMore ? page + 1 : undefined, searchUrl: typeof result.searchURL === 'string' ? result.searchURL : undefined };
        },

        async getItems(asins: string[], market?: string): Promise<AmazonProduct[]> {
            const data = await call(cfg, 'getItems', {
                itemIds: asins.slice(0, 10),
                itemIdType: 'ASIN',
                marketplace: market ?? marketplace,
                resources: RESOURCES,
            });
            return (data?.itemsResult?.items ?? data?.items ?? []).map((item: any) => normalizeItem(item, cfg)).filter((p: AmazonProduct) => p.asin);
        },

        async getVariations(parentAsin: string, market?: string): Promise<AmazonProduct[]> {
            const data = await call(cfg, 'getVariations', {
                asin: parentAsin,
                marketplace: market ?? marketplace,
                resources: [...RESOURCES, 'variationSummary.price', 'variationSummary.availability'],
            });
            const variations = data?.variationsResult?.items ?? data?.items ?? [];
            return variations.map((item: any) => normalizeItem(item, cfg)).filter((p: AmazonProduct) => p.asin);
        },
    };
}
