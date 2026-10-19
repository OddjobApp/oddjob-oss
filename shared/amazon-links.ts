const MARKETPLACE_HOST = /^(?:www\.)?amazon\.(?:com|ca|com\.mx|com\.br|co\.uk|de|fr|it|es|nl|se|pl|com\.be|ie|co\.jp|in|com\.au|sg|ae|sa|com\.tr|eg)$/i;
export function isAmazonMarketplace(host: string): boolean { return MARKETPLACE_HOST.test(host); }
export function isAmazonUrl(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && isAmazonMarketplace(url.hostname); } catch { return false; }
}
