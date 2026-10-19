/**
 * Amazon link builders.
 *
 * The only checkout primitive Amazon sanctions for third parties is the
 * Associates cart link — `gp/aws/cart/add.html` opens a confirmation page in
 * the user's own browser, where a human completes checkout. These builders are
 * pure: they never authenticate, never touch an Amazon session, and validate
 * their input so a malformed ASIN or quantity cannot produce a misleading link.
 */

import { isAmazonMarketplace, isAmazonUrl } from '@shared/amazon-links.js';
const ASIN_RE = /^[A-Z0-9]{10}$/i;
export const MAX_CART_ITEMS = 10;
export const MAX_QUANTITY = 999;

export function isAsin(value: unknown): value is string {
    return typeof value === 'string' && ASIN_RE.test(value);
}

/** Throws unless `value` is a valid ASIN; returns it normalized uppercase. */
export function assertAsin(value: string): string {
    if (!isAsin(value)) throw new Error(`'${value}' is not a valid ASIN (10 letters/digits)`);
    return value.toUpperCase();
}

/** "https://www.amazon.co.uk/x", "amazon.de", undefined → "www.amazon.com". */
export function normalizeMarketplace(value?: string | null): string {
    const raw = String(value ?? '').trim();
    if (!raw) return 'www.amazon.com';
    const host = raw.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!isAmazonMarketplace(host)) {
        throw new Error(`'${raw}' is not an Amazon marketplace host (expected e.g. www.amazon.com)`);
    }
    return host.startsWith('amazon.') ? `www.${host}` : host;
}

export function buildProductUrl(marketplace: string, asin: string, tag?: string): string {
    if (!isAsin(asin)) throw new Error(`'${asin}' is not a valid ASIN (10 letters/digits)`);
    const host = normalizeMarketplace(marketplace);
    const url = `https://${host}/dp/${asin.toUpperCase()}`;
    return tag ? `${url}?tag=${encodeURIComponent(tag)}` : url;
}

export interface CartItem {
    asin: string;
    quantity: number;
}

/**
 * The documented Associates cart link. A tag is added only when configured —
 * the link still adds items to the user's cart without one, just unattributed.
 */
export function buildCartUrl(marketplace: string, tag: string | undefined, items: CartItem[]): string {
    const host = normalizeMarketplace(marketplace);
    if (!Array.isArray(items) || items.length === 0) throw new Error('A cart needs at least one item');
    if (items.length > MAX_CART_ITEMS) throw new Error(`A cart link holds at most ${MAX_CART_ITEMS} items`);
    const params = new URLSearchParams();
    if (tag) params.set('AssociateTag', tag);
    items.forEach((item, i) => {
        if (!isAsin(item.asin)) throw new Error(`'${item.asin}' is not a valid ASIN`);
        if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY) {
            throw new Error(`Quantity for ${item.asin} must be 1–${MAX_QUANTITY}`);
        }
        params.set(`ASIN.${i + 1}`, item.asin.toUpperCase());
        params.set(`Quantity.${i + 1}`, String(item.quantity));
    });
    return `https://${host}/gp/aws/cart/add.html?${params.toString()}`;
}

/** Items back out of a cart URL we generated — used when an approval re-prices. */
export function parseCartUrl(cartUrl: unknown): CartItem[] {
    if (!isAmazonUrl(cartUrl)) return [];
    const params = new URL(cartUrl).searchParams;
    const items: CartItem[] = [];
    for (let i = 1; i <= MAX_CART_ITEMS; i++) {
        const asin = params.get(`ASIN.${i}`);
        if (!asin) break;
        items.push({ asin, quantity: Number(params.get(`Quantity.${i}`)) || 1 });
    }
    return items;
}
