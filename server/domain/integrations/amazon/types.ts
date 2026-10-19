/**
 * Normalized Amazon product shape shared by every provider, so the Creators
 * API and the pluggable scraping providers (Rainforest, SerpApi) are
 * interchangeable behind `AmazonProductProvider`.
 *
 * Amazon has no checkout API and blocks agents from driving a user's session,
 * so this model ends at discovery: a product's `url` is a detail page the
 * human opens, and carts are handed off as links — never automated.
 */

export type AmazonProviderId = 'creators' | 'rainforest' | 'serpapi';

export interface AmazonProduct {
    asin: string;
    title: string;
    brand?: string;
    imageUrl?: string;
    /** Detail page URL — affiliate-tagged when a partner tag is configured. */
    url: string;
    price?: { amount: number; currency: string; display: string };
    listPriceDisplay?: string;
    rating?: number;
    reviewCount?: number;
    isPrime?: boolean;
    availability?: string;
    merchant?: string;
    features?: string[];
    parentAsin?: string;
}

export interface AmazonSearchOptions {
    keywords: string;
    /** Provider category, e.g. Creators API `searchIndex` ("Electronics"). */
    searchIndex?: string;
    /** 1–10 per request (the API's own bound). */
    itemCount?: number;
    /** 1–10. */
    itemPage?: number;
    /** Major currency units (e.g. 24.99); providers convert if needed. */
    minPrice?: number;
    maxPrice?: number;
    brand?: string;
    primeOnly?: boolean;
    sortBy?: string;
    /** Marketplace override for this call, e.g. "www.amazon.co.uk". */
    marketplace?: string;
}

export interface AmazonSearchResult {
    items: AmazonProduct[];
    totalResults?: number;
    nextPage?: number;
    searchUrl?: string;
}

export interface AmazonProductProvider {
    id: AmazonProviderId;
    searchItems(opts: AmazonSearchOptions): Promise<AmazonSearchResult>;
    getItems(asins: string[], marketplace?: string): Promise<AmazonProduct[]>;
    getVariations(parentAsin: string, marketplace?: string): Promise<AmazonProduct[]>;
}
